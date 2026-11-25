/**
 * Lifetime subscriptions - the client side of "give this person everything,
 * forever, until I take it back".
 *
 * The database owns the grant. `public.subscriptions` has a row per user with
 * `is_lifetime` and `status`; only the owner can write it, through the
 * `admin_grant_lifetime` / `admin_revoke_lifetime` RPCs. This module keeps a
 * mirror of `my_lifetime_subscription()` in `localStorage` so UI gates stay
 * synchronous and re-syncs with Supabase on sign-in, focus, and mount.
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

/** Fired whenever the cached grant changes, so the UI can re-render. */
export const LIFETIME_EVENT = "lifetime-change";

const PLAN_LABELS: Record<LifetimePlan, string> = {
  pro: "Pro Forever",
  vip: "VIP Forever",
  all: "All Access Forever",
};

const cacheKey = (handle: string) => `lifetime:${handle}`;

export function lifetimePlanLabel(plan?: string | null): string {
  return PLAN_LABELS[plan as LifetimePlan] ?? "Lifetime";
}

function emit(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LIFETIME_EVENT));
  }
}

/* -------------------------------------------------------------------------- */
/*  Reading & Cache                                                           */
/* -------------------------------------------------------------------------- */

/** True only for a live grant. A canceled row is *not* active. */
export function isLifetimeActive(grant?: LifetimeGrant | null): boolean {
  return Boolean(grant?.isLifetime && grant.status === "active");
}

/**
 * True when the grant was taken away. The app treats this as "no plan", which
 * is what sends the user back to the paywall.
 */
export function isLifetimeRevoked(grant?: LifetimeGrant | null): boolean {
  return Boolean(grant && grant.status === "canceled");
}

/** Synchronous read of the last known server grant for this handle. */
export function cachedLifetime(handle?: string | null): LifetimeGrant | null {
  if (!handle || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKey(handle));
    return raw ? (JSON.parse(raw) as LifetimeGrant) : null;
  } catch {
    return null;
  }
}

function writeCache(handle: string, grant: LifetimeGrant | null) {
  if (typeof window === "undefined") return;
  try {
    if (grant) localStorage.setItem(cacheKey(handle), JSON.stringify(grant));
    else localStorage.removeItem(cacheKey(handle));
  } catch {
    /* private mode / quota */
  }
  emit();
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
 * Pull the authoritative grant from Supabase and cache it.
 *
 * A network error leaves the cache alone rather than wrongly revoking access
 * while the viewer is genuinely offline; a real server response (including
 * `null` or `status = 'canceled'`) overwrites it immediately.
 */
export async function refreshLifetime(handle?: string | null): Promise<LifetimeGrant | null> {
  if (!handle) return null;

  const { data, error } = await rpc("my_lifetime_subscription");
  if (error) return cachedLifetime(handle);

  const grant = toGrant(data);
  writeCache(handle, grant);
  return grant;
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
