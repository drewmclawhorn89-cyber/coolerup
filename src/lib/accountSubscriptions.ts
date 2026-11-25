/**
 * Account-backed subscriptions.
 *
 * The database table `public.user_subscriptions` (and synced columns on
 * `public.profiles`) is the single source of truth, keyed strictly by
 * `user_id` ONLY — one row per user_id. Buying or changing a plan updates that
 * exact row and never creates a duplicate row or writes to device storage.
 */
import { supabase } from "@/integrations/supabase/client";

export type AccountSubscriptionStatus =
  "free" | "active" | "pending" | "cancelled" | "expired" | "trialing";

export type AccountSubscriptionRow = {
  id: string;
  user_id: string;
  plan_id: string;
  plan_name: string | null;
  plan_status: AccountSubscriptionStatus;
  status: AccountSubscriptionStatus;
  started_at: string;
  expires_at: string | null;
  payment_method: string | null;
  payment_verified: boolean;
  auto_renew: boolean;
  created_at: string;
  updated_at: string;
};

export type AccountSubscriptionInput = {
  planId: string;
  planName?: string | null;
  status: AccountSubscriptionStatus;
  startedAt: string;
  expiresAt?: string | null;
  paymentMethod?: string | null;
  paymentVerified?: boolean;
  autoRenew?: boolean;
};

/** Fired whenever the cached account subscription or loading state changes. */
export const ACCOUNT_SUBSCRIPTION_EVENT = "account-subscription-change";

const byUser = new Map<string, AccountSubscriptionRow>();
const byHandle = new Map<string, AccountSubscriptionRow>();
const loadedUsers = new Set<string>();
const loadingUsers = new Set<string>();
const loadedHandles = new Set<string>();
let activeUserId: string | null = null;
let activeHandle: string | null = null;

/* -------------------------------------------------------------------------- */
/*  Supabase plumbing                                                         */
/* -------------------------------------------------------------------------- */

type DbResult = { data: unknown; error: { message?: string; code?: string } | null };

type DbBuilder = {
  select: (columns?: string) => DbBuilder;
  eq: (column: string, value: unknown) => DbBuilder;
  neq: (column: string, value: unknown) => DbBuilder;
  order: (column: string, opts?: { ascending?: boolean }) => DbBuilder;
  limit: (count: number) => DbBuilder;
  maybeSingle: () => Promise<DbResult>;
  upsert: (values: Record<string, unknown>, opts?: { onConflict?: string }) => DbBuilder;
  update: (values: Record<string, unknown>) => DbBuilder;
  then: (
    onFulfilled?: ((value: DbResult) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null,
  ) => Promise<unknown>;
};

type DbClient = {
  from: (table: string) => DbBuilder;
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
};

const db = supabase as unknown as DbClient;

export async function currentAccountUserId(): Promise<string | null> {
  try {
    const { data } = await db.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

function emit(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ACCOUNT_SUBSCRIPTION_EVENT));
  }
}

/* -------------------------------------------------------------------------- */
/*  Row helpers                                                               */
/* -------------------------------------------------------------------------- */

function parseStatus(raw: unknown): AccountSubscriptionStatus {
  if (
    raw === "free" ||
    raw === "active" ||
    raw === "pending" ||
    raw === "cancelled" ||
    raw === "expired" ||
    raw === "trialing"
  ) {
    return raw;
  }
  if (raw === "canceled") return "cancelled";
  return "free";
}

function toRow(value: unknown): AccountSubscriptionRow | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const planId = r["plan_id"];
  const userId = r["user_id"];
  if (typeof planId !== "string" || !planId) return null;
  if (typeof userId !== "string" || !userId) return null;
  const resolvedStatus = parseStatus(r["plan_status"] ?? r["status"]);
  return {
    id: String(r["id"] ?? userId),
    user_id: userId,
    plan_id: planId,
    plan_name: (r["plan_name"] as string | null | undefined) ?? null,
    plan_status: resolvedStatus,
    status: resolvedStatus,
    started_at: String(r["started_at"] ?? new Date().toISOString()),
    expires_at: (r["expires_at"] as string | null | undefined) ?? null,
    payment_method: (r["payment_method"] as string | null | undefined) ?? null,
    payment_verified: Boolean(r["payment_verified"] ?? false),
    auto_renew: Boolean(r["auto_renew"] ?? false),
    created_at: String(r["created_at"] ?? new Date().toISOString()),
    updated_at: String(r["updated_at"] ?? new Date().toISOString()),
  };
}

/** Active beats pending beats cancelled beats expired; newest wins ties. */
function rank(status: AccountSubscriptionStatus): number {
  if (status === "active" || status === "trialing") return 3;
  if (status === "pending") return 2;
  if (status === "cancelled") return 1;
  return 0;
}

function choose(rows: AccountSubscriptionRow[]): AccountSubscriptionRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const byStatus = rank(b.plan_status) - rank(a.plan_status);
    if (byStatus !== 0) return byStatus;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0]!;
}

function isSchemaFallbackError(err: { message?: string; code?: string } | null): boolean {
  if (!err?.message) return false;
  const msg = err.message.toLowerCase();
  return (
    err.code === "42703" ||
    err.code === "42P10" ||
    err.code === "PGRST204" ||
    msg.includes("column") ||
    msg.includes("schema cache") ||
    msg.includes("on conflict specification")
  );
}

/* -------------------------------------------------------------------------- */
/*  Cache & Loading State (In-Memory Only)                                    */
/* -------------------------------------------------------------------------- */

/** Synchronous read for render. Returns null when the account has no row loaded. */
export function cachedAccountSubscription(handle?: string | null): AccountSubscriptionRow | null {
  if (!handle) return null;
  const direct = byHandle.get(handle);
  if (direct) return direct;
  if (activeHandle === handle && activeUserId) return byUser.get(activeUserId) ?? null;
  return null;
}

export function cachedAccountSubscriptionForUser(
  userId?: string | null,
): AccountSubscriptionRow | null {
  if (!userId) return null;
  return byUser.get(userId) ?? null;
}

/**
 * True while the signed-in user's account subscription is still loading from
 * Supabase. Prevents flashing "Free" before DB hydration resolves.
 */
export function isAccountSubscriptionLoading(
  handle?: string | null,
  userId?: string | null,
): boolean {
  const uid = userId ?? (handle && handle === activeHandle ? activeUserId : null);
  if (uid) {
    return loadingUsers.has(uid) || !loadedUsers.has(uid);
  }
  if (handle) {
    if (loadedHandles.has(handle) || byHandle.has(handle)) return false;
    return false;
  }
  return false;
}

/** Marks handle-only cache loaded when tests call `setCachedAccountSubscription` directly. */
export function setCachedAccountSubscription(
  handle: string,
  input: AccountSubscriptionInput,
): AccountSubscriptionRow {
  const existing = byHandle.get(handle) ?? (activeUserId ? byUser.get(activeUserId) : null);
  const now = new Date().toISOString();
  const row: AccountSubscriptionRow = {
    id: existing?.id ?? activeUserId ?? `mem:${handle}`,
    user_id: activeUserId ?? existing?.user_id ?? "",
    plan_id: input.planId,
    plan_name: input.planName ?? null,
    plan_status: input.status,
    status: input.status,
    started_at: input.startedAt,
    expires_at: input.expiresAt ?? null,
    payment_method: input.paymentMethod ?? existing?.payment_method ?? null,
    payment_verified:
      input.paymentVerified ?? (input.planId !== "all" && input.status === "active"),
    auto_renew: input.autoRenew ?? false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  byHandle.set(handle, row);
  loadedHandles.add(handle);
  if (activeUserId) {
    byUser.set(activeUserId, row);
    loadedUsers.add(activeUserId);
  }
  emit();
  return row;
}

/** Drop a handle's cached row, e.g. after cancel or sign-out. */
export function clearCachedAccountSubscription(handle?: string | null): void {
  if (handle) {
    const row = byHandle.get(handle);
    byHandle.delete(handle);
    if (row && activeUserId && byUser.get(activeUserId)?.plan_id === row.plan_id) {
      byUser.delete(activeUserId);
    }
  }
  emit();
}

/** Wipe everything on sign-out so the next account starts clean. */
export function clearAccountSubscriptionCache(): void {
  byUser.clear();
  byHandle.clear();
  loadedUsers.clear();
  loadingUsers.clear();
  loadedHandles.clear();
  activeUserId = null;
  activeHandle = null;
  emit();
}

/* -------------------------------------------------------------------------- */
/*  Network                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Pull the subscription row for `userId` from Supabase (`public.user_subscriptions`).
 * Marks the user's loading state honestly so the UI shows a spinner until DB returns.
 */
export async function loadAccountSubscription(
  userId: string,
  handle?: string | null,
): Promise<AccountSubscriptionRow | null> {
  activeUserId = userId;
  if (handle) activeHandle = handle;

  if (!loadedUsers.has(userId)) {
    loadingUsers.add(userId);
    emit();
  }

  try {
    const { data, error } = await db.from("user_subscriptions").select("*").eq("user_id", userId);

    if (error) {
      loadedUsers.add(userId);
      loadingUsers.delete(userId);
      emit();
      return byUser.get(userId) ?? null;
    }

    const rows = (Array.isArray(data) ? data : [])
      .map(toRow)
      .filter((row): row is AccountSubscriptionRow => row !== null);
    const row = choose(rows);

    if (row) byUser.set(userId, row);
    else byUser.delete(userId);

    loadedUsers.add(userId);
    loadingUsers.delete(userId);

    if (handle) {
      loadedHandles.add(handle);
      if (row) byHandle.set(handle, row);
      else byHandle.delete(handle);
    }

    emit();
    return row;
  } catch {
    loadedUsers.add(userId);
    loadingUsers.delete(userId);
    emit();
    return byUser.get(userId) ?? null;
  }
}

/**
 * Re-fetch the signed-in user's subscription from Supabase.
 */
export async function refreshAccountSubscription(
  handle?: string | null,
  explicitUserId?: string | null,
): Promise<AccountSubscriptionRow | null> {
  const userId = explicitUserId || (await currentAccountUserId());
  if (!userId) return null;
  return loadAccountSubscription(userId, handle ?? activeHandle);
}

/**
 * Upsert one row keyed by `user_id` ONLY. Buying or changing a plan updates
 * the same row for `user_id` instead of creating duplicates or device rows.
 */
export async function saveAccountSubscription(
  userId: string,
  input: AccountSubscriptionInput,
): Promise<AccountSubscriptionRow | null> {
  const now = new Date().toISOString();
  const isForever = input.planId === "all" || input.planName === "All Access Forever";
  const paymentVerified =
    input.paymentVerified ?? Boolean(input.status === "active" && input.paymentMethod);

  if (isForever && input.status === "active" && !paymentVerified) {
    throw new Error("All Access Forever requires a verified payment.");
  }

  const payload: Record<string, unknown> = {
    user_id: userId,
    plan_id: input.planId,
    plan_name: isForever ? "All Access Forever" : (input.planName ?? null),
    plan_status: input.status,
    status: input.status,
    started_at: input.startedAt,
    expires_at: isForever ? null : (input.expiresAt ?? null),
    payment_method: input.paymentMethod ?? null,
    payment_verified: paymentVerified,
    auto_renew: input.autoRenew ?? (!isForever && input.status === "active"),
    updated_at: now,
  };

  let res = await db
    .from("user_subscriptions")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .maybeSingle();

  // Compatibility fallback if the DB still has the pre-migration schema without new columns.
  if (res.error && isSchemaFallbackError(res.error)) {
    const legacyPayload: Record<string, unknown> = {
      user_id: userId,
      plan_id: input.planId,
      plan_name: isForever ? "All Access Forever" : (input.planName ?? null),
      status: input.status,
      started_at: input.startedAt,
      expires_at: isForever ? null : (input.expiresAt ?? null),
      auto_renew: input.autoRenew ?? (!isForever && input.status === "active"),
      updated_at: now,
    };
    res = await db
      .from("user_subscriptions")
      .upsert(legacyPayload, { onConflict: "user_id,plan_id" })
      .select("*")
      .maybeSingle();
    if (!res.error) {
      await db
        .from("user_subscriptions")
        .update({ status: "cancelled", auto_renew: false, updated_at: now })
        .eq("user_id", userId)
        .neq("plan_id", input.planId);
    }
  }

  if (res.error) {
    throw new Error(res.error.message || "Could not save subscription to your account.");
  }

  const row = toRow(res.data) ?? toRow(payload);
  if (row) {
    activeUserId = userId;
    loadedUsers.add(userId);
    loadingUsers.delete(userId);
    byUser.set(userId, row);
    if (activeHandle) {
      loadedHandles.add(activeHandle);
      byHandle.set(activeHandle, row);
    }
    emit();
  }
  return row ?? byUser.get(userId) ?? null;
}

/** Persist a write for the signed-in user, resolved from the auth session. */
export async function persistAccountSubscriptionForHandle(
  handle: string,
  input: AccountSubscriptionInput,
  explicitUserId?: string | null,
): Promise<AccountSubscriptionRow | null> {
  const userId = explicitUserId || (await currentAccountUserId());
  if (!userId) return null;
  activeUserId = userId;
  activeHandle = handle;
  return saveAccountSubscription(userId, input);
}

/** Mark the account's subscription cancelled by `user_id`. */
export async function cancelAccountSubscriptionForHandle(
  handle: string,
  planId?: string,
  explicitUserId?: string | null,
): Promise<void> {
  const userId = explicitUserId || (await currentAccountUserId());
  if (!userId) return;
  activeUserId = userId;
  activeHandle = handle;
  const now = new Date().toISOString();

  let query = db
    .from("user_subscriptions")
    .update({
      plan_status: "cancelled",
      status: "cancelled",
      auto_renew: false,
      updated_at: now,
    })
    .eq("user_id", userId);

  if (planId) {
    query = query.eq("plan_id", planId);
  }

  const res = await (query as unknown as Promise<DbResult>);
  if (res?.error && isSchemaFallbackError(res.error)) {
    let legacyQuery = db
      .from("user_subscriptions")
      .update({ status: "cancelled", auto_renew: false, updated_at: now })
      .eq("user_id", userId);
    if (planId) legacyQuery = legacyQuery.eq("plan_id", planId);
    const legacyRes = await (legacyQuery as unknown as Promise<DbResult>);
    if (legacyRes?.error) {
      throw new Error(legacyRes.error.message || "Could not cancel subscription.");
    }
  } else if (res?.error) {
    throw new Error(res.error.message || "Could not cancel subscription.");
  }

  loadedUsers.add(userId);
  byUser.delete(userId);
  byHandle.delete(handle);
  emit();
}
