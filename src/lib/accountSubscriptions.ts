/**
 * Account-backed subscriptions.
 *
 * The database table `public.user_subscriptions` is the single source of truth.
 * This module keeps a small in-memory cache so the UI can paint synchronously,
 * but it never writes subscription state to localStorage, cookies or any other
 * device store. Signing in on a new phone hydrates the cache from Supabase, so
 * the plan follows the account.
 *
 * One row per (user_id, plan_id): buying or renewing a plan upserts that row,
 * so a second purchase never creates a duplicate. Buying a different plan
 * marks the previous plans cancelled.
 */
import { supabase } from "@/integrations/supabase/client";

export type AccountSubscriptionStatus =
  | "active"
  | "pending"
  | "cancelled"
  | "expired"
  | "trialing";

export type AccountSubscriptionRow = {
  id: string;
  user_id: string;
  plan_id: string;
  plan_name: string | null;
  status: AccountSubscriptionStatus;
  started_at: string;
  expires_at: string | null;
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
  autoRenew?: boolean;
};

/** Fired whenever the cached account subscription changes. */
export const ACCOUNT_SUBSCRIPTION_EVENT = "account-subscription-change";

const byUser = new Map<string, AccountSubscriptionRow>();
const byHandle = new Map<string, AccountSubscriptionRow>();
let activeUserId: string | null = null;
let activeHandle: string | null = null;

/* -------------------------------------------------------------------------- */
/*  Supabase plumbing                                                         */
/* -------------------------------------------------------------------------- */

type DbResult = { data: unknown; error: { message?: string } | null };

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

/**
 * The generated Supabase types predate `user_subscriptions`, so this narrow
 * wrapper keeps the call sites typed without editing the generated file.
 */
const db = supabase as unknown as DbClient;

async function currentUserId(): Promise<string | null> {
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

function toRow(value: unknown): AccountSubscriptionRow | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const planId = r["plan_id"];
  const userId = r["user_id"];
  if (typeof planId !== "string" || !planId) return null;
  if (typeof userId !== "string" || !userId) return null;
  const status = r["status"];
  return {
    id: String(r["id"] ?? `${userId}:${planId}`),
    user_id: userId,
    plan_id: planId,
    plan_name: (r["plan_name"] as string | null | undefined) ?? null,
    status:
      status === "active" ||
      status === "pending" ||
      status === "cancelled" ||
      status === "expired" ||
      status === "trialing"
        ? status
        : "expired",
    started_at: String(r["started_at"] ?? new Date().toISOString()),
    expires_at: (r["expires_at"] as string | null | undefined) ?? null,
    auto_renew: Boolean(r["auto_renew"] ?? true),
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
    const byStatus = rank(b.status) - rank(a.status);
    if (byStatus !== 0) return byStatus;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0]!;
}

/* -------------------------------------------------------------------------- */
/*  Cache                                                                     */
/* -------------------------------------------------------------------------- */

/** Synchronous read for render. Returns null when the account has no plan. */
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

/** Replace the cached row for a handle without touching the network. */
export function setCachedAccountSubscription(
  handle: string,
  input: AccountSubscriptionInput,
): AccountSubscriptionRow {
  const existing = byHandle.get(handle) ?? (activeUserId ? byUser.get(activeUserId) : null);
  const now = new Date().toISOString();
  const row: AccountSubscriptionRow = {
    id: existing?.id ?? `local:${handle}:${input.planId}`,
    user_id: activeUserId ?? existing?.user_id ?? "",
    plan_id: input.planId,
    plan_name: input.planName ?? null,
    status: input.status,
    started_at: input.startedAt,
    expires_at: input.expiresAt ?? null,
    auto_renew: input.autoRenew ?? true,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  byHandle.set(handle, row);
  if (activeUserId) byUser.set(activeUserId, row);
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
  activeUserId = null;
  activeHandle = null;
  emit();
}

/* -------------------------------------------------------------------------- */
/*  Network                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Pull every row for this account and cache the one that is in force.
 * On a network error the existing cache is kept, so losing signal does not
 * strip a paying user of their plan.
 */
export async function loadAccountSubscription(
  userId: string,
  handle?: string | null,
): Promise<AccountSubscriptionRow | null> {
  activeUserId = userId;
  if (handle) activeHandle = handle;

  const { data, error } = await db
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId);

  if (error) return byUser.get(userId) ?? null;

  const rows = (Array.isArray(data) ? data : [])
    .map(toRow)
    .filter((row): row is AccountSubscriptionRow => row !== null);
  const row = choose(rows);

  if (row) byUser.set(userId, row);
  else byUser.delete(userId);

  if (handle) {
    if (row) byHandle.set(handle, row);
    else byHandle.delete(handle);
  }

  emit();
  return row;
}

/**
 * Re-fetch the signed-in user's subscription. This is what the "Restore
 * Subscription" button and the focus/login refreshes call.
 */
export async function refreshAccountSubscription(
  handle?: string | null,
): Promise<AccountSubscriptionRow | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  return loadAccountSubscription(userId, handle ?? activeHandle);
}

/**
 * Upsert one row for (user_id, plan_id). The unique constraint means a repeat
 * purchase updates the same row instead of inserting a duplicate.
 */
export async function saveAccountSubscription(
  userId: string,
  input: AccountSubscriptionInput,
): Promise<AccountSubscriptionRow | null> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    user_id: userId,
    plan_id: input.planId,
    plan_name: input.planName ?? null,
    status: input.status,
    started_at: input.startedAt,
    expires_at: input.expiresAt ?? null,
    auto_renew: input.autoRenew ?? true,
    updated_at: now,
  };

  const { data, error } = await db
    .from("user_subscriptions")
    .upsert(payload, { onConflict: "user_id,plan_id" })
    .select("*")
    .maybeSingle();

  // A new plan supersedes the old one. Keep the rows (history) but make sure
  // only the plan just written can be in force.
  await db
    .from("user_subscriptions")
    .update({ status: "cancelled", auto_renew: false, updated_at: now })
    .eq("user_id", userId)
    .neq("plan_id", input.planId);

  if (error) return byUser.get(userId) ?? null;

  const row = toRow(data) ?? toRow(payload);
  if (row) {
    byUser.set(userId, row);
    if (activeHandle) byHandle.set(activeHandle, row);
    emit();
  }
  return row ?? byUser.get(userId) ?? null;
}

/** Persist a write for the signed-in user, resolved from the auth session. */
export async function persistAccountSubscriptionForHandle(
  handle: string,
  input: AccountSubscriptionInput,
): Promise<AccountSubscriptionRow | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  activeUserId = userId;
  activeHandle = handle;
  return saveAccountSubscription(userId, input);
}

/** Mark a plan cancelled on the account. */
export async function cancelAccountSubscriptionForHandle(
  handle: string,
  planId: string,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  activeUserId = userId;
  activeHandle = handle;
  const now = new Date().toISOString();
  await db
    .from("user_subscriptions")
    .update({ status: "cancelled", auto_renew: false, updated_at: now })
    .eq("user_id", userId)
    .eq("plan_id", planId);
}
