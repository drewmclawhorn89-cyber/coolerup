/**
 * Client-side Web Push plumbing, shared by the global registrar, the settings
 * screen, and the call provider.
 *
 * The app already had push for incoming calls only. This module makes the
 * subscription reusable so *any* notification (likes, comments, follows,
 * reposts, story likes, DMs) can reach the device even when Coolerup is closed.
 */
import {
  savePushSubscription,
  removePushSubscription,
  sendTestPush as sendTestPushFn,
  getPushStatus as getPushStatusFn,
} from "@/lib/push.functions";

const VAPID_PUBLIC_KEY = import.meta.env["VITE_VAPID_PUBLIC_KEY"] as string | undefined;

/**
 * True when this build was given a VAPID public key. If it's false, the browser
 * cannot create a subscription at all, so out-of-app notifications are
 * impossible until the key is configured and the app is redeployed.
 */
export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY);
}

/** Ask the server whether it can send push and how many devices we have. */
export type PushStatus = { configured: boolean; devices: number; source: string };

export async function pushStatus(): Promise<PushStatus> {
  return getPushStatusFn();
}

/** Send a test notification to this user's registered devices. */
export async function sendTestPush(): Promise<{ sent: number; configured: boolean }> {
  return sendTestPushFn();
}

/** True when the browser exposes everything we need for Web Push. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Whether the user has push notifications turned on in Coolerup's settings. */
export function pushPrefEnabled(): boolean {
  try {
    return localStorage.getItem("settings:notifications") !== "false";
  } catch {
    return true;
  }
}

/** "unsupported" | "default" | "granted" | "denied" */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

/**
 * Ask for permission (if needed), subscribe this device, and persist the
 * subscription against the signed-in user. Safe to call repeatedly — it reuses
 * an existing subscription and simply re-saves it.
 *
 * Returns true when this device is subscribed.
 */
export async function ensurePushSubscription(): Promise<boolean> {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return false;

  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
  }
  if (Notification.permission !== "granted") return false;

  try {
    const reg = await registerServiceWorker();
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
      }));

    const json = sub.toJSON();
    const p256dh = json.keys?.["p256dh"];
    const auth = json.keys?.["auth"];
    if (!json.endpoint || !p256dh || !auth) return false;

    await savePushSubscription({ data: { endpoint: json.endpoint, p256dh, auth } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Unsubscribe this device and forget it on the server. Other devices the user
 * has signed in on keep their own subscriptions.
 */
export async function disablePushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await removePushSubscription({ data: { endpoint } }).catch(() => undefined);
  } catch {
    // Best effort: the browser may already have dropped the subscription.
  }
}

/** Fire when the master notification switch changes so the registrar can react. */
export const PUSH_PREF_EVENT = "coolerup:push-pref-changed";
export function announcePushPref(enabled: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent(PUSH_PREF_EVENT, { detail: enabled }));
  } catch {
    // ignore
  }
}

/**
 * Human-readable device diagnostics. "Push sends fine but nothing appears" is
 * almost always one of: iOS running in a Safari tab instead of an installed
 * Home Screen app, permission not granted, or no live subscription on this
 * device. This reports all three so the cause is obvious.
 */
export type PushDiagnostics = {
  platform: string;
  standalone: boolean;
  ios: boolean;
  permission: string;
  supported: boolean;
  configured: boolean;
  subscribed: boolean;
  /** Host of this device's push endpoint, e.g. web.push.apple.com / fcm.googleapis.com */
  endpointHost: string | null;
  hint: string;
};

export async function pushDiagnostics(): Promise<PushDiagnostics> {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Macintosh but has touch points.
    (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);

  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  let subscribed = false;
  let endpointHost: string | null = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    subscribed = Boolean(sub);
    if (sub?.endpoint) {
      try {
        endpointHost = new URL(sub.endpoint).host;
      } catch {
        endpointHost = null;
      }
    }
  } catch {
    subscribed = false;
  }

  const permission =
    typeof Notification === "undefined" ? "unsupported" : Notification.permission;

  let hint = "";
  if (ios && !standalone) {
    hint =
      "On iPhone/iPad, notifications only work after adding Coolerup to your Home Screen (Share → Add to Home Screen) and enabling them inside that installed app.";
  } else if (permission === "denied") {
    hint = "Notifications are blocked for this site in your browser settings.";
  } else if (permission === "default") {
    hint = "Notification permission hasn't been granted yet. Tap Enable and allow it.";
  } else if (!subscribed) {
    hint = "This device isn't subscribed. Tap Enable to register it.";
  } else if (ios) {
    hint =
      "iPhone shows banners only when Coolerup is in the background. Close the app (or lock the screen) before sending a test.";
  } else {
    hint = "Everything looks correct on this device.";
  }

  return {
    platform: ua,
    standalone,
    ios,
    permission,
    supported: pushSupported(),
    configured: pushConfigured(),
    subscribed,
    endpointHost,
    hint,
  };
}
