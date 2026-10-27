import { supabase } from "@/integrations/supabase/client";

/**
 * The kill switch.
 *
 * `app_settings.is_maintenance` has existed in the schema since day one and
 * nothing ever read it. This is the code that reads it: flip the switch (from
 * /admin) and every open client shuts the app down and shows a holding page
 * instead of half-broken UI while you publish.
 *
 * Reads go through the `app_status()` RPC rather than the table, because
 * `app_settings` is admin-only (see 0004_lock_down_sensitive_tables.sql) and
 * signed-out visitors still need to see the holding page.
 *
 * Fails open everywhere: if the RPC is missing or the network is down, the app
 * keeps working. A maintenance flag that can strand users because of a network
 * blip is worse than no maintenance flag.
 */

export type AppStatus = {
  maintenance: boolean;
  message: string | null;
  updatedAt: string | null;
};

export const DEFAULT_MAINTENANCE_MESSAGE =
  "Coolerup is getting an update. We'll be back in a minute.";

export const LIVE: AppStatus = { maintenance: false, message: null, updatedAt: null };

type StatusRow = {
  is_maintenance?: boolean | null;
  maintenance_message?: string | null;
  updated_at?: string | null;
};

/** Coerce whatever the RPC returned into a usable status. */
export function normalizeStatus(input: unknown): AppStatus {
  const row = (Array.isArray(input) ? input[0] : input) as StatusRow | null | undefined;
  if (!row) return LIVE;
  return {
    maintenance: row.is_maintenance === true,
    message: row.maintenance_message?.trim() || null,
    updatedAt: row.updated_at ?? null,
  };
}

/** Current status, or null when it can't be determined (caller fails open). */
export async function fetchAppStatus(): Promise<AppStatus | null> {
  try {
    const { data, error } = await supabase.rpc("app_status");
    if (error) return null;
    return normalizeStatus(data);
  } catch {
    return null;
  }
}

/** Admin-only: flip the switch. */
export async function setAppStatus(
  maintenance: boolean,
  message?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc("set_app_status", {
      _maintenance: maintenance,
      _message: message?.trim() ? message.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't update app status" };
  }
}

export type StatusWatcherOptions = {
  onChange: (status: AppStatus) => void;
  /** Poll cadence. Short: the point is to react to a deploy within seconds. */
  intervalMs?: number;
  /** Injectable for tests. Return null to simulate an unreachable backend. */
  probe?: () => Promise<AppStatus | null>;
};

/**
 * Polls the switch and reports every *change*.
 *
 * Unknown statuses (null) are ignored rather than treated as "live", so a
 * single dropped request doesn't flash the app back on mid-maintenance.
 */
export function watchAppStatus(options: StatusWatcherOptions): () => void {
  const { onChange, intervalMs = 15_000, probe = fetchAppStatus } = options;
  let stopped = false;
  let last: AppStatus | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const check = async () => {
    if (stopped) return;
    const next = await probe();
    if (stopped || !next) return;
    if (last && last.maintenance === next.maintenance && last.message === next.message) return;
    last = next;
    onChange(next);
  };

  void check();
  timer = setInterval(() => void check(), intervalMs);

  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}
