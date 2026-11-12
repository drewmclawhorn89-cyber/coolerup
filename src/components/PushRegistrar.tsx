import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  PUSH_PREF_EVENT,
  ensurePushSubscription,
  pushPrefEnabled,
  pushSupported,
} from "@/lib/push-client";

/**
 * Mounted once inside the auth provider. Quietly makes sure the signed-in
 * user's device is registered for Web Push so notifications arrive when the app
 * is closed or in the background — not only during calls.
 *
 * It never prompts on its own unless permission was already granted; the first
 * permission request happens from an explicit tap (settings or the first call),
 * which browsers require anyway.
 */
export function PushRegistrar() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !pushSupported()) return;
    if (!pushPrefEnabled()) return;

    let cancelled = false;

    const register = () => {
      if (cancelled) return;
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        void ensurePushSubscription();
      }
    };

    register();

    const onPref = (e: Event) => {
      const enabled = (e as CustomEvent<boolean>).detail;
      if (enabled) void ensurePushSubscription();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") register();
    };

    window.addEventListener(PUSH_PREF_EVENT, onPref);
    document.addEventListener("visibilitychange", onVisible);

    // The service worker pings us when the browser rotates the push
    // subscription; re-register so we don't go silently stale. It also forwards
    // pushes it received, so we can show an in-app banner when the OS won't.
    const onSwMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "coolerup:resubscribe-push") {
        void ensurePushSubscription();
        return;
      }
      if (msg.type === "coolerup:push-received" && document.visibilityState === "visible") {
        // iOS (and some Android builds) suppress the system banner while the app
        // is open, so surface it here instead of letting it disappear.
        const p = msg.payload || {};
        toast(p.title || "Coolerup", { description: p.body || undefined });
      }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMessage);
    }

    return () => {
      cancelled = true;
      window.removeEventListener(PUSH_PREF_EVENT, onPref);
      document.removeEventListener("visibilitychange", onVisible);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
    };
  }, [user?.id]);

  return null;
}
