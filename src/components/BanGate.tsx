import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

type BanStatus = {
  is_banned: boolean;
  reason: string | null;
  is_permanent: boolean;
  expires_at: string | null;
};

/**
 * App-wide ban gate.
 *
 * The database blocks all reads/writes for banned accounts (see
 * drizzle/migrations/0015_ban_enforcement.sql), but that alone would leave the
 * user staring at a broken, empty app. This component asks the
 * `my_ban_status()` RPC once the session loads and, if the account is banned,
 * replaces the entire app with a clear explanation + sign-out button.
 *
 * Mounted inside AuthProvider in __root.tsx so it covers every route
 * (feed, profile, settings, messages, deep links) instead of just "/".
 */
export function BanGate({ children }: { children: React.ReactNode }) {
  const { user, ready, signOut } = useAuth();
  const [status, setStatus] = useState<BanStatus | null>(null);
  const lastUserId = useRef<string | null>(null);

  const check = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("my_ban_status");
      if (error) {
        // RPC missing (migration not applied yet) or a network hiccup: fail open
        // so a transient error never locks a legitimate user out of the app.
        setStatus(null);
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) as BanStatus | null;
      setStatus(row?.is_banned ? row : null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      lastUserId.current = null;
      setStatus(null);
      return;
    }
    if (lastUserId.current === user.id) return;
    lastUserId.current = user.id;
    void check();
  }, [ready, user, check]);

  // Re-check when the tab regains focus and every 60s, so a ban applied while
  // the app is open takes effect without a hard refresh.
  useEffect(() => {
    if (!user) return;
    const recheck = () => void check();
    const id = window.setInterval(recheck, 60_000);
    window.addEventListener("focus", recheck);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", recheck);
    };
  }, [user, check]);

  if (status?.is_banned) {
    const until =
      status.is_permanent || !status.expires_at
        ? null
        : new Date(status.expires_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          });

    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-background px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/15">
          <Ban className="h-10 w-10 text-destructive" />
        </div>
        <div className="max-w-sm space-y-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Your account is suspended
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {status.reason
              ? status.reason
              : "You no longer have access to coolerup because this account was banned."}
          </p>
          {until ? (
            <p className="text-sm font-medium text-foreground">Access returns on {until}.</p>
          ) : (
            <p className="text-sm font-medium text-foreground">This suspension is permanent.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Think this was a mistake? Reply to the notice you received or contact support to appeal.
          </p>
        </div>
        <Button variant="secondary" className="gap-2" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
