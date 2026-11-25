/**
 * Account-backed subscriptions.
 *
 * Syncs subscription rows from `public.user_subscriptions` and caches the
 * latest row per handle in `localStorage` so synchronous reads work offline
 * and across renders.
 */
import { supabase } from "@/integrations/supabase/client";

export type AccountSubscriptionStatus = "active" | "pending" | "cancelled" | "expired" | "trialing";

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

const CACHE_PREFIX = "acct-sub:";
const cacheKey = (handle: string) => `${CACHE_PREFIX}${handle}`;

/* -------------------------------------------------------------------------- */
/*  Supabase plumbing                                                         */
/* -------------------------------------------------------------------------- */

type DbResult = { data: unknown; error: { message?: string } | null };

type DbBuilder = {
  select: (columns?: string) => DbBuilder;
  eq: (column: string, value: unknown) => DbBuilder;
  neq: (column: string, value: unknown) => DbBuilder;
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

function parseStatus(raw: unknown): AccountSubscriptionStatus {
  if (
    raw === "active" ||
    raw === "pending" ||
    raw === "cancelled" ||
    raw === "expired" ||
    raw === "trialing"
  ) {
    return raw;
  }
  if (raw === "canceled") return "cancelled";
  return "expired";
}

function toRow(value: unknown): AccountSubscriptionRow | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const planId = r["plan_id"];
  const userId = r["user_id"];
  if (typeof planId !== "string" || !planId) return null;
  if (typeof userId !== "string" || !userId) return null;
  return {
    id: String(r["id"] ?? `${userId}:${planId}`),
    user_id: userId,
    plan_id: planId,
    plan_name: (r["plan_name"] as string | null | undefined) ?? null,
    status: parseStatus(r["status"]),
    started_at: String(r["started_at"] ?? new Date().toISOString()),
    expires_at: (r["expires_at"] as string | null | undefined) ?? null,
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
    const byStatus = rank(b.status) - rank(a.status);
    if (byStatus !== 0) return byStatus;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0]!;
}

/* -------------------------------------------------------------------------- */
/*  Cache (localStorage)                                                      */
/* -------------------------------------------------------------------------- */

export function cachedAccountSubscription(handle?: string | null): AccountSubscriptionRow | null {
  if (!handle || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(handle));
    return raw ? (JSON.parse(raw) as AccountSubscriptionRow) : null;
  } catch {
    return null;
  }
}

export function setCachedAccountSubscription(
  handle: string,
  input: AccountSubscriptionInput,
): AccountSubscriptionRow {
  const existing = cachedAccountSubscription(handle);
  const now = new Date().toISOString();
  const row: AccountSubscriptionRow = {
    id: existing?.id ?? `local:${handle}:${input.planId}`,
    user_id: existing?.user_id ?? "",
    plan_id: input.planId,
    plan_name: input.planName ?? null,
    status: input.status,
    started_at: input.startedAt,
    expires_at: input.expiresAt ?? null,
    auto_renew: input.autoRenew ?? false,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(cacheKey(handle), JSON.stringify(row));
    } catch {
      /* private mode / quota */
    }
  }
  emit();
  return row;
}

export function clearCachedAccountSubscription(handle?: string | null): void {
  if (!handle || typeof window === "undefined") return;
  try {
    localStorage.removeItem(cacheKey(handle));
  } catch {
    /* ignore */
  }
  emit();
}

export function clearAccountSubscriptionCache(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  emit();
}

/* -------------------------------------------------------------------------- */
/*  Network                                                                   */
/* -------------------------------------------------------------------------- */

export async function loadAccountSubscription(
  userId: string,
  handle?: string | null,
): Promise<AccountSubscriptionRow | null> {
  try {
    const { data, error } = await db.from("user_subscriptions").select("*").eq("user_id", userId);
    if (error) return cachedAccountSubscription(handle);
    const rows = (Array.isArray(data) ? data : [])
      .map(toRow)
      .filter((row): row is AccountSubscriptionRow => row !== null);
    const row = choose(rows);
    if (handle && typeof window !== "undefined") {
      try {
        if (row) localStorage.setItem(cacheKey(handle), JSON.stringify(row));
        else localStorage.removeItem(cacheKey(handle));
      } catch {
        /* ignore */
      }
      emit();
    }
    return row;
  } catch {
    return cachedAccountSubscription(handle);
  }
}

export async function refreshAccountSubscription(
  handle?: string | null,
): Promise<AccountSubscriptionRow | null> {
  const userId = await currentUserId();
  if (!userId) return cachedAccountSubscription(handle);
  return loadAccountSubscription(userId, handle);
}

export async function persistAccountSubscriptionForHandle(
  handle: string,
  input: AccountSubscriptionInput,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const now = new Date().toISOString();
  await db.from("user_subscriptions").upsert(
    {
      user_id: userId,
      plan_id: input.planId,
      plan_name: input.planName ?? null,
      status: input.status,
      started_at: input.startedAt,
      expires_at: input.expiresAt ?? null,
      auto_renew: input.autoRenew ?? input.status === "active",
      updated_at: now,
    },
    { onConflict: "user_id,plan_id" },
  );
  await db
    .from("user_subscriptions")
    .update({ status: "cancelled", auto_renew: false, updated_at: now })
    .eq("user_id", userId)
    .neq("plan_id", input.planId);
  await loadAccountSubscription(userId, handle);
}

export async function cancelAccountSubscriptionForHandle(
  handle: string,
  planId?: string,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const now = new Date().toISOString();
  let query = db
    .from("user_subscriptions")
    .update({ status: "cancelled", auto_renew: false, updated_at: now })
    .eq("user_id", userId);
  if (planId) query = query.eq("plan_id", planId);
  await query;
  clearCachedAccountSubscription(handle);
}
