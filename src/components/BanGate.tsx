import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, LogOut, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { checkIdentityBan, getDeviceId, registerDevice } from "@/lib/autoBans";

type BanStatus = {
  is_banned: boolean;
  reason: string | null;
  is_permanent: boolean;
  expires_at: string | null;
};

/**
 * App-wide ban gate.
 *
 * The database blocks all reads/writes for banned accounts, but that alone
 * would leave the user staring at a broken, empty app. This component asks
 * `my_ban_status()` once the session loads and, if the account is banned,
 * replaces the entire app with a clear explanation + sign-out button.
 *
 * It also does two jobs for Auto Bans:
 *   1. registers the current device so a permanent ban can burn it, and
 *   2. checks whether this device is already burned, so a brand-new account
 *      on a banned phone is stopped at the door.
 *
 * Mounted inside AuthProvider in __root.tsx so it covers every route.
 */
export function BanGate({ children }: { children: React.ReactNode }) {
  const { user, ready, handle, signOut } = useAuth();
  const [status, setStatus] = useState<BanStatus | null>(null);
  const [deviceBanned, setDeviceBanned] = useState(false);
  const lastUserId = useRef<string | null>(null);

  const check = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("my_ban_status");
      if (error) {
        setStatus(null);
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) as BanStatus | null;
      if (row?.is_banned) {
        setStatus(row);
        return;
      }

      // Fallback: `my_ban_status` resolves the ban through the profiles row. If
      // that row is missing, or the ban was saved against a differently-cased /
      // "@"-prefixed handle, ask by handle directly.
      if (handle) {
        const { data: byHandle } = await supabase.rpc("ban_status_for_handle", {
          _handle: handle,
        });
        const handleRow = (Array.isArray(byHandle) ? byHandle[0] : byHandle) as BanStatus | null;
        if (handleRow?.is_banned) {
          setStatus(handleRow);
          return;
        }
      }

      setStatus(null);
    } catch {
      setStatus(null);
    }
  }, [handle]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      lastUserId.current = null;
      setStatus(null);
      setDeviceBanned(false);
      return;
    }
    if (lastUserId.current === user.id) return;
    lastUserId.current = user.id;
    void check();

    // Register this device, then make sure it is not already burned. A device
    // ban is checked even for a fresh account, which is the whole point.
    void (async () => {
      await registerDevice();
      const deviceId = getDeviceId();
      if (!deviceId) return;
      const hit = await checkIdentityBan("device", deviceId);
      if (hit.banned) setDeviceBanned(true);
    })();
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

  if (deviceBanned) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-black px-6 text-center text-white">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(254,44,85,0.16)" }}
        >
          <Smartphone className="h-10 w-10" style={{ color: "#FE2C55" }} />
        </div>
        <div className="max-w-sm space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">This device is banned from Coolerup</h1>
          <p className="text-sm leading-relaxed text-white/60">
            A Coolerup account on this device was permanently banned for breaking the rules, so new
            accounts cannot be created here.
          </p>
          <p className="text-xs text-white/40">
            Think this was a mistake? Contact support to appeal.
          </p>
        </div>
        <Button variant="secondary" className="gap-2" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    );
  }

  if (status?.is_banned) {
    const until =
      status.is_permanent || !status.expires_at
        ? null
        : new Date(status.expires_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          });

    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-black px-6 text-center text-white">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(254,44,85,0.16)" }}
        >
          <Ban className="h-10 w-10" style={{ color: "#FE2C55" }} />
        </div>
        <div className="max-w-sm space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {status.is_permanent
              ? "Your account is permanently banned"
              : "Your account is suspended"}
          </h1>
          <p className="text-sm leading-relaxed text-white/60">
            {status.reason
              ? status.reason
              : "You no longer have access to Coolerup because this account was banned."}
          </p>
          {until ? (
            <p className="text-sm font-medium text-white">Access returns on {until}.</p>
          ) : (
            <p className="text-sm font-medium text-white">
              You can no longer watch, post, comment or message.
            </p>
          )}
          <p className="text-xs text-white/40">
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
