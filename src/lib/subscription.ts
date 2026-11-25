/**
 * Lifetime subscriptions - the client side of "give this person everything,
 * forever, until I take it back".
 *
 * The database owns the grant. `public.subscriptions` has a row per user with
 * `is_lifetime` and `status`; only the owner can write it, through the
 * `admin_grant_lifetime` / `admin_revoke_lifetime` RPCs.
 *
 * Strictly memory-only on the client: zero localStorage, cookies, or device
 * storage is ever read or written for subscription or plan state.
 * Owner @drewmclawhorn3 never loses their plan on login or refresh.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LifetimePlan = "pro" | "vip" | "all";
export type LifetimeStatus = "active" | "pending" | "canceled" | "expired";

export type LifetimeGrant = {
  plan: LifetimePlan;
  status: LifetimeStatus;
  isLifetime: boolean;
  grantedBy: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
};

/** Fired whenever the in-memory grant cache changes, so the UI can re-render. */
export const LIFETIME_EVENT = "lifetime-change";

export const OWNER_HANDLE = "drewmclawhorn3";

const PLAN_LABELS: Record<LifetimePlan, string> = {
  pro: "Pro Forever",
  vip: "VIP Forever",
  all: "All Access Forever",
};

const OWNER_DEFAULT_GRANT: LifetimeGrant = {
  plan: "all",
  status: "active",
  isLifetime: true,
  grantedBy: OWNER_HANDLE,
  grantedAt: null,
  revokedAt: null,
};

/** Strictly in-memory cache keyed by normalized handle. Never persisted to device storage. */
const lifetimeMemoryCache = new Map<string, LifetimeGrant>();

function normHandle(handle?: string | null): string {
  return (handle ?? "").trim().replace(/^@/, "").toLowerCase();
}

export function isOwnerHandle(handle?: string | null): boolean {
  return normHandle(handle) === OWNER_HANDLE;
}

export function lifetimePlanLabel(plan?: string | null): string {
  return PLAN_LABELS[plan as LifetimePlan] ?? "Lifetime";
}

function emitLifetime(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LIFETIME_EVENT));
  }
}

/* -------------------------------------------------------------------------- */
/*  Reading & In-Memory Cache                                                 */
/* -------------------------------------------------------------------------- */

/** True only for a live grant. A canceled row is *not* active. */
export function isLifetimeActive(grant?: LifetimeGrant | null): boolean {
  return Boolean(grant?.isLifetime && grant?.status === "active");
}

/**
 * True when the grant was taken away. The app treats this as "no plan", which
 * is what sends the user back to the paywall.
 */
export function isLifetimeRevoked(grant?: LifetimeGrant | null): boolean {
  return Boolean(grant && grant.status === "canceled");
}

/**
 * The in-memory grant for this handle, if any.
 * Never reads localStorage or any device store.
 * Owner @drewmclawhorn3 always keeps their plan.
 */
export function cachedLifetime(handle?: string | null): LifetimeGrant | null {
  const key = normHandle(handle);
  if (!key || typeof window === "undefined") return null;
  const hit = lifetimeMemoryCache.get(key);
  if (hit) return hit;
  if (isOwnerHandle(key)) return OWNER_DEFAULT_GRANT;
  return null;
}

/** Updates the in-memory lifetime grant cache without writing to device storage. */
export function setCachedLifetimeGrant(
  handle: string,
  grant: LifetimeGrant | null,
): LifetimeGrant | null {
  const key = normHandle(handle);
  if (!key) return null;
  if (grant) {
    lifetimeMemoryCache.set(key, grant);
  } else {
    lifetimeMemoryCache.delete(key);
  }
  emitLifetime();
  return grant;
}

function writeCache(handle: string, grant: LifetimeGrant | null) {
  const key = normHandle(handle);
  if (!key) return;
  if (isOwnerHandle(key) && (!grant || grant.status !== "active" || !grant.isLifetime)) {
    // Owner @drewmclawhorn3 never loses their plan on login or refresh.
    lifetimeMemoryCache.set(key, grant && isLifetimeActive(grant) ? grant : OWNER_DEFAULT_GRANT);
  } else if (grant) {
    lifetimeMemoryCache.set(key, grant);
  } else {
    lifetimeMemoryCache.delete(key);
  }
  emitLifetime();
}

/* -------------------------------------------------------------------------- */
/*  RPC plumbing                                                              */
/* -------------------------------------------------------------------------- */

type RpcResponse = { data: unknown; error: { message: string } | null };

async function rpc(name: string, args?: Record<string, unknown>): Promise<RpcResponse> {
  const call = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<RpcResponse>;
  try {
    return await call(name, args);
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "Network error" },
    };
  }
}

function toGrant(row: unknown): LifetimeGrant | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const plan = r["plan"];
  if (!plan) return null;
  return {
    plan: plan as LifetimePlan,
    status: (r["status"] ?? "active") as LifetimeStatus,
    isLifetime: Boolean(r["is_lifetime"] ?? r["isLifetime"]),
    grantedBy: (r["granted_by"] ?? r["grantedBy"] ?? null) as string | null,
    grantedAt: (r["granted_at"] ?? r["grantedAt"] ?? null) as string | null,
    revokedAt: (r["revoked_at"] ?? r["revokedAt"] ?? null) as string | null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Sync                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pull the authoritative grant from Supabase and update the in-memory cache.
 * Owner @drewmclawhorn3 always keeps their active All Access Forever grant.
 */
export async function refreshLifetime(handle?: string | null): Promise<LifetimeGrant | null> {
  if (!handle) return null;

  const { data, error } = await rpc("my_lifetime_subscription");
  if (error) {
    if (isOwnerHandle(handle)) {
      const preserved = lifetimeMemoryCache.get(normHandle(handle)) ?? OWNER_DEFAULT_GRANT;
      lifetimeMemoryCache.set(normHandle(handle), preserved);
      return preserved;
    }
    return cachedLifetime(handle);
  }

  const grant = toGrant(data);
  if (isOwnerHandle(handle) && (!grant || !isLifetimeActive(grant))) {
    writeCache(handle, OWNER_DEFAULT_GRANT);
    return OWNER_DEFAULT_GRANT;
  }
  writeCache(handle, grant);
  return grant;
}

/** Drop the in-memory grant cache, e.g. on sign-out. */
export function clearLifetimeCache(handle?: string | null) {
  if (!handle) {
    lifetimeMemoryCache.clear();
    emitLifetime();
    return;
  }
  const key = normHandle(handle);
  if (key) {
    lifetimeMemoryCache.delete(key);
    emitLifetime();
  }
}

/**
 * Live grant for this handle.
 * Hydrates from Supabase on mount, on focus, and whenever the cache changes.
 */
export function useLifetimeGrant(handle?: string | null) {
  const [grant, setGrant] = useState<LifetimeGrant | null>(() => cachedLifetime(handle));

  useEffect(() => {
    const sync = () => setGrant(cachedLifetime(handle));
    sync();
    window.addEventListener(LIFETIME_EVENT, sync);
    window.addEventListener("focus", sync);
    void refreshLifetime(handle);
    return () => {
      window.removeEventListener(LIFETIME_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [handle]);

  return grant;
}

/* -------------------------------------------------------------------------- */
/*  Admin                                                                     */
/* -------------------------------------------------------------------------- */

export type AdminResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ADMIN_ERRORS: Record<string, string> = {
  not_admin: "Only @drewmclawhorn3 can give lifetime plans",
  missing_handle: "Pick a user first",
  invalid_plan: "Choose Pro, VIP or All",
  user_not_found: "No user with that handle",
  not_found: "That grant no longer exists",
  cannot_revoke_owner: "Owner @drewmclawhorn3 always keeps their plan",
};

function adminError(code?: string): string {
  return ADMIN_ERRORS[code ?? ""] ?? "Something went wrong. Try again.";
}

export type LifetimeUser = {
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  plan: LifetimePlan | null;
  isLifetime: boolean;
  /** When the grant was made, for the "Since Nov 8" line. */
  grantedAt: string | null;
};

function toUser(row: unknown): LifetimeUser | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = (r["user_id"] ?? r["userId"]) as string | undefined;
  const handle = r["handle"] as string | undefined;
  if (!id || !handle) return null;
  return {
    userId: id,
    handle,
    displayName: (r["display_name"] ?? r["displayName"] ?? null) as string | null,
    avatarUrl: (r["avatar_url"] ?? r["avatarUrl"] ?? null) as string | null,
    plan: (r["plan"] ?? null) as LifetimePlan | null,
    isLifetime: Boolean(r["is_lifetime"] ?? r["isLifetime"]),
    grantedAt: (r["granted_at"] ?? r["grantedAt"] ?? null) as string | null,
  };
}

function toUsers(data: unknown): LifetimeUser[] {
  const rows = (data as { users?: unknown } | null)?.users;
  if (!Array.isArray(rows)) return [];
  return rows.map(toUser).filter((u): u is LifetimeUser => u !== null);
}

/** Give a user a lifetime plan. `all` also grants 1,000 coins server-side. */
export async function grantLifetime(
  handle: string,
  plan: LifetimePlan,
): Promise<AdminResult<LifetimeUser>> {
  const { data, error } = await rpc("admin_grant_lifetime", { _handle: handle, _plan: plan });
  if (error) return { ok: false, message: error.message || adminError() };

  const row = (data ?? {}) as { ok?: boolean; error?: string; user_id?: string; handle?: string };
  if (!row.ok) return { ok: false, message: adminError(row.error) };

  return {
    ok: true,
    value: {
      userId: row.user_id ?? "",
      handle: row.handle ?? handle,
      displayName: null,
      avatarUrl: null,
      plan,
      isLifetime: true,
      grantedAt: new Date().toISOString(),
    },
  };
}

/** Take it away. The user is blocked on their next subscription check. */
export async function revokeLifetime(userId: string): Promise<AdminResult<true>> {
  const { data, error } = await rpc("admin_revoke_lifetime", { _user_id: userId });
  if (error) return { ok: false, message: error.message || adminError() };

  const row = (data ?? {}) as { ok?: boolean; error?: string };
  if (!row.ok) return { ok: false, message: adminError(row.error) };
  return { ok: true, value: true };
}

/** Everyone holding a live lifetime grant. */
export async function listLifetime(): Promise<LifetimeUser[]> {
  const { data, error } = await rpc("admin_list_lifetime");
  if (error) return [];
  return toUsers(data);
}

/** Typeahead over handles, usernames and display names. */
export async function searchUsers(query: string): Promise<LifetimeUser[]> {
  const q = query.trim().replace(/^@/, "");
  if (!q) return [];
  const { data, error } = await rpc("admin_search_users", { _q: q });
  if (error) return [];
  return toUsers(data);
}
