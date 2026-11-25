/**
 * Lifetime subscriptions - the client side of "give this person everything,
 * forever, until I take it back".
 *
 * The database owns the grant. `public.subscriptions` has a row per user with
 * `is_lifetime` and `status`; only the owner can write it, through the
 * `admin_grant_lifetime` / `admin_revoke_lifetime` RPCs.
 *
 * This module keeps a copy in localStorage purely so the first paint is instant
 * and so the app still works for a moment offline. The copy is never trusted
 * over the server: `refreshLifetime` runs on mount and on every window focus,
 * and a revoked grant wipes the cache and fires an event, so access disappears
 * on the next check rather than lingering until some expiry date.
 *
 * A lifetime grant has no expiry at all. Nothing in this file - or in
 * `getSubscription` - ever reads `current_period_end` for a lifetime row.
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

const key = (handle: string) => `lifetime:${handle}`;

const PLAN_LABELS: Record<LifetimePlan, string> = {
  pro: "Pro Forever",
  vip: "VIP Forever",
  all: "All Access Forever",
};

export function lifetimePlanLabel(plan?: string | null): string {
  return PLAN_LABELS[plan as LifetimePlan] ?? "Lifetime";
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                   */
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

/** The cached grant, if any. Synchronous, so it can be used during render. */
export function cachedLifetime(handle?: string | null): LifetimeGrant | null {
  if (!handle || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(handle));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LifetimeGrant>;
    if (!parsed || typeof parsed !== "object" || !parsed.plan) return null;
    return {
      plan: parsed.plan as LifetimePlan,
      status: (parsed.status ?? "active") as LifetimeStatus,
      isLifetime: Boolean(parsed.isLifetime),
      grantedBy: parsed.grantedBy ?? null,
      grantedAt: parsed.grantedAt ?? null,
      revokedAt: parsed.revokedAt ?? null,
    };
  } catch {
    return null;
  }
}

function writeCache(handle: string, grant: LifetimeGrant | null) {
  if (typeof window === "undefined") return;
  if (grant) window.localStorage.setItem(key(handle), JSON.stringify(grant));
  else window.localStorage.removeItem(key(handle));
  window.dispatchEvent(new Event(LIFETIME_EVENT));
}

/* -------------------------------------------------------------------------- */
/*  RPC plumbing                                                              */
/* -------------------------------------------------------------------------- */

type RpcResponse = { data: unknown; error: { message: string } | null };

/**
 * The generated Supabase types predate these RPCs, so this wrapper keeps the
 * call sites typed without editing the generated file. `supabase.rpc` reads
 * `this.rest` internally, hence the bind.
 */
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
 * Pull the authoritative grant for this handle and update the cache.
 *
 * Returns the grant, or null when there is none. On a network error the cache
 * is left alone - losing signal should not strip someone of a plan they have.
 */
export async function refreshLifetime(handle?: string | null): Promise<LifetimeGrant | null> {
  if (!handle) return null;

  const { data, error } = await rpc("my_lifetime_subscription");
  if (error) return cachedLifetime(handle);

  const grant = toGrant(data);
  writeCache(handle, grant);
  return grant;
}

/** Drop the cached grant, e.g. on sign-out. */
export function clearLifetimeCache(handle?: string | null) {
  if (!handle || typeof window === "undefined") return;
  window.localStorage.removeItem(key(handle));
  window.dispatchEvent(new Event(LIFETIME_EVENT));
}

/**
 * Live grant for this handle.
 *
 * Seeds from the cache so the badge is right on the first render, then refreshes
 * from the server on mount, on focus, and whenever the cache changes.
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
