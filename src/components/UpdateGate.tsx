import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { reloadIntoNewBuild, watchForUpdate } from "@/lib/appBuild";
import { DEFAULT_MAINTENANCE_MESSAGE, watchAppStatus, type AppStatus } from "@/lib/maintenance";

/**
 * App-wide update gate — the "shut the app down" switch.
 *
 * Two ways the app goes dark, both mounted here so they cover every route:
 *
 *  1. Maintenance. An admin flips `app_settings.is_maintenance` (Admin → Update
 *     mode) before publishing. Every open client stops rendering the app and
 *     shows a holding page, so nobody is clicking around a half-deployed build.
 *
 *  2. Stale build. Each build carries an id. When the server reports a
 *     different id than the one this tab booted with, a newer build is live:
 *     the tab shuts down and reloads itself into it.
 *
 * Shutting down means literally unmounting `children` — no feed timers, no
 * video playback, no sockets, no writes from old code.
 *
 * Fails open on purpose (same rule as BanGate): if the status can't be read,
 * the app runs. Locking everyone out because of one dropped request is worse
 * than letting a stale tab live another minute.
 *
 * Admins can step through the maintenance page, so flipping the switch can
 * never lock the owner out of their own app.
 */

const RELOAD_SECONDS = 5;
const BYPASS_KEY = "update-gate:bypass";

type Shutdown =
  | { kind: "maintenance"; status: AppStatus }
  | { kind: "stale"; serverBuild: string }
  | null;

export function UpdateGate({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  const [shutdown, setShutdown] = useState<Shutdown>(null);
  const [bypassed, setBypassed] = useState(false);
  const [seconds, setSeconds] = useState(RELOAD_SECONDS);
  const [reloading, setReloading] = useState(false);

  // A bypass lasts for this tab only.
  useEffect(() => {
    try {
      setBypassed(sessionStorage.getItem(BYPASS_KEY) === "1");
    } catch {
      // Private mode: no sessionStorage, no bypass. Fine.
    }
  }, []);

  // Maintenance switch.
  useEffect(() => {
    const stop = watchAppStatus({
      onChange: (status) => {
        setShutdown((current) => {
          if (status.maintenance) return { kind: "maintenance", status };
          // Switch flipped back off: only clear a maintenance shutdown.
          return current?.kind === "maintenance" ? null : current;
        });
      },
    });
    return stop;
  }, []);

  // New build shipped.
  useEffect(() => {
    const stop = watchForUpdate({
      onStale: (serverBuild) => setShutdown({ kind: "stale", serverBuild }),
    });
    return stop;
  }, []);

  const isStale = shutdown?.kind === "stale";

  // Countdown then reload. A stale client is never allowed to keep running: if
  // the reload is blocked, the page still stays shut down.
  useEffect(() => {
    if (!isStale) return;
    setSeconds(RELOAD_SECONDS);
    const tick = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(tick);
          setReloading(true);
          void reloadIntoNewBuild();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [isStale]);

  const bypass = useCallback(() => {
    try {
      sessionStorage.setItem(BYPASS_KEY, "1");
    } catch {
      // In-memory bypass still applies.
    }
    setBypassed(true);
  }, []);

  const down = shutdown && !(shutdown.kind === "maintenance" && bypassed && isAdmin);

  if (!down) return <>{children}</>;

  if (shutdown.kind === "stale") {
    return (
      <ShutdownScreen
        icon={<RefreshCw className="h-8 w-8 text-primary" />}
        title="Coolerup just updated"
        body="A new version is live. Reloading you now so you don't hit bugs from the old one."
        footer={
          <Button
            className="w-full"
            onClick={() => {
              setReloading(true);
              void reloadIntoNewBuild();
            }}
            disabled={reloading}
          >
            {reloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reloading…
              </>
            ) : (
              `Reload now (${seconds})`
            )}
          </Button>
        }
      />
    );
  }

  return (
    <ShutdownScreen
      icon={<Wrench className="h-8 w-8 text-primary" />}
      title="Coolerup is updating"
      body={shutdown.status.message || DEFAULT_MAINTENANCE_MESSAGE}
      footer={
        <>
          <p className="text-xs text-muted-foreground">
            This page unlocks on its own as soon as the update is done.
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={bypass}
              className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              I'm an admin — let me in anyway
            </button>
          )}
        </>
      }
    />
  );
}

function ShutdownScreen({
  icon,
  title,
  body,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  footer: React.ReactNode;
}) {
  return (
    <main
      role="alertdialog"
      aria-live="assertive"
      aria-label={title}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
        {icon}
      </div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      <div className="mt-2 flex w-full max-w-xs flex-col items-center gap-3">{footer}</div>
    </main>
  );
}
