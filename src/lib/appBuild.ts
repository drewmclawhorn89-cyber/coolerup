/**
 * Build identity + "has a newer version shipped?" detection.
 *
 * Coolerup is a long-lived tab app: people leave it open for hours. When a new
 * build is published, an open tab keeps running the old JavaScript against the
 * new database, which is exactly how you get "it worked five minutes ago"
 * bug reports after every deploy.
 *
 * So each build carries an id. The client remembers the id it booted with, and
 * asks the server (same deployment, so always the newest build) what id it is
 * serving. Mismatch means: shut the app down and reload into the new build.
 *
 * Everything here fails open. A flaky network must never lock people out of a
 * working app — a false "update available" is far worse than a missed one.
 */

/** The id baked into this bundle by vite.config.ts. */
export function appBuildId(): string {
  try {
    // `typeof` guard: tests and ad-hoc scripts don't run the vite define.
    return typeof __APP_BUILD__ === "string" && __APP_BUILD__ ? __APP_BUILD__ : "dev";
  } catch {
    return "dev";
  }
}

/**
 * True when the client is running an older build than the server.
 *
 * Deliberately conservative:
 *  - "dev" on either side means we can't compare, so we don't.
 *  - only an exact string match counts as up to date.
 */
export function isStaleBuild(clientBuild: string, serverBuild: string | null | undefined): boolean {
  if (!clientBuild || !serverBuild) return false;
  if (clientBuild === "dev" || serverBuild === "dev") return false;
  return clientBuild !== serverBuild;
}

export type UpdateWatcherOptions = {
  /** Called once when a newer build is detected. */
  onStale: (serverBuild: string) => void;
  /** How often to check while the tab is visible. Default 60s. */
  intervalMs?: number;
  /** Ask the server for its build id. Injectable for tests. */
  probe?: () => Promise<string | null>;
  /** The build this client booted with. Injectable for tests. */
  clientBuild?: string;
};

/**
 * Polls the server for its build id and fires `onStale` at most once.
 *
 * Checks are skipped while the tab is hidden (phones throttle timers anyway)
 * and re-run immediately on `visibilitychange`, so coming back to a
 * backgrounded tab is the moment a stale client finds out.
 *
 * Returns a cleanup function.
 */
export function watchForUpdate(options: UpdateWatcherOptions): () => void {
  const { onStale, intervalMs = 60_000, probe, clientBuild = appBuildId() } = options;
  let stopped = false;
  let fired = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const check = async () => {
    if (stopped || fired) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const serverBuild = probe ? await probe() : await defaultProbe();
      if (stopped || fired) return;
      if (isStaleBuild(clientBuild, serverBuild)) {
        fired = true;
        onStale(serverBuild as string);
      }
    } catch {
      // Network hiccup: try again next tick. Never shut the app down on this.
    }
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

async function defaultProbe(): Promise<string | null> {
  const { getServerBuild } = await import("@/lib/appBuild.functions");
  const res = await getServerBuild();
  return res?.build ?? null;
}

/**
 * Reload into the new build, dropping the cached app shell first so the
 * service worker can't hand back the old HTML.
 *
 * Only `coolerup-shell*` caches are touched — downloaded offline videos live
 * elsewhere and must survive an update.
 */
export async function reloadIntoNewBuild(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("coolerup-shell")).map((k) => caches.delete(k)),
      );
    }
  } catch {
    // Cache API unavailable or blocked: a plain reload still gets the new build.
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    reg?.waiting?.postMessage("SKIP_WAITING");
  } catch {
    // No service worker: nothing to skip.
  }
  window.location.reload();
}
