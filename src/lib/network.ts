/**
 * Network awareness for low-bandwidth conditions.
 *
 * The app should stay usable on 2G, flaky Wi-Fi and metered data. This module
 * normalises the (non-standard) Network Information API into a single snapshot
 * and decides when "lite mode" should kick in. It also exposes a React hook so
 * components can react when the connection improves or degrades.
 *
 * A single module-level listener feeds every subscriber, so a 20-card feed does
 * not register 20 separate window/connection listeners.
 */
import { useSyncExternalStore } from "react";
import { LOW_DATA_MODE_PREF, readBool, writePref } from "./prefs";

export type EffectiveType = "slow-2g" | "2g" | "3g" | "4g" | "unknown";

export type NetworkInfo = {
  online: boolean;
  /** Network Information API effective type, or "unknown" when unsupported. */
  effectiveType: EffectiveType;
  /** Estimated downlink in Mbps. 0 when unknown. */
  downlink: number;
  /** Estimated round-trip time in ms. 0 when unknown. */
  rtt: number;
  /** Browser-level "reduce data usage" signal (Android Chrome). */
  saveData: boolean;
  /** True when the connection reports itself as cellular. */
  cellular: boolean;
};

type NavigatorConnection = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

function getConnection(): NavigatorConnection | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (
    (navigator as unknown as { connection?: NavigatorConnection }).connection ??
    (navigator as unknown as { mozConnection?: NavigatorConnection }).mozConnection ??
    (navigator as unknown as { webkitConnection?: NavigatorConnection }).webkitConnection
  );
}

const DEFAULT_INFO: NetworkInfo = {
  online: true,
  effectiveType: "unknown",
  downlink: 0,
  rtt: 0,
  saveData: false,
  cellular: false,
};

export function getNetworkInfo(): NetworkInfo {
  if (typeof navigator === "undefined") return DEFAULT_INFO;
  const conn = getConnection();
  const rawType = conn?.effectiveType;
  const effectiveType: EffectiveType =
    rawType === "slow-2g" || rawType === "2g" || rawType === "3g" || rawType === "4g"
      ? rawType
      : "unknown";
  return {
    online: navigator.onLine !== false,
    effectiveType,
    downlink: typeof conn?.downlink === "number" ? conn.downlink : 0,
    rtt: typeof conn?.rtt === "number" ? conn.rtt : 0,
    saveData: !!conn?.saveData,
    cellular: conn?.type === "cellular",
  };
}

/**
 * Low Data Mode in Settings: lower quality video first, no auto-play, smaller
 * images, and 0 background preloading.
 */
export function isLowDataMode(): boolean {
  return readBool(LOW_DATA_MODE_PREF, false);
}

export function setLowDataMode(enabled: boolean): void {
  writePref(LOW_DATA_MODE_PREF, String(enabled));
}

/**
 * Lite mode is on when the user asked for Low Data Mode / Lite Mode, the
 * browser asked to save data, or the connection looks genuinely constrained.
 */
export function isLiteMode(info: NetworkInfo = getNetworkInfo()): boolean {
  if (!info.online) return true;
  if (isLowDataMode()) return true;
  if (readBool("lite-mode")) return true;
  if (readBool("data-saver")) return true;
  if (info.saveData) return true;
  if (info.effectiveType === "slow-2g" || info.effectiveType === "2g") return true;
  if (info.downlink > 0 && info.downlink < 0.6) return true;
  if (info.rtt > 0 && info.rtt > 800) return true;
  return false;
}

/** True when the connection is metered (used for Wi-Fi-only uploads). */
export function isCellularConnection(info: NetworkInfo = getNetworkInfo()): boolean {
  return info.cellular;
}

/** How many feed items to request per page. Load 10 videos at a time. */
export const FEED_PAGE_SIZE = 10;

export function feedPageSize(_info: NetworkInfo = getNetworkInfo()): number {
  return FEED_PAGE_SIZE;
}

// --- shared subscription ----------------------------------------------------

let snapshot: NetworkInfo | null = null;
const listeners = new Set<() => void>();
let attached = false;

function refresh() {
  snapshot = getNetworkInfo();
  listeners.forEach((listener) => listener());
}

function ensureAttached() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  const conn = getConnection();
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  window.addEventListener("storage", refresh);
  window.addEventListener("loop-prefs-changed", refresh);
  conn?.addEventListener?.("change", refresh);
}

function subscribe(listener: () => void): () => void {
  ensureAttached();
  listeners.add(listener);
  // Prime the snapshot so the first render has real values.
  if (!snapshot) snapshot = getNetworkInfo();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NetworkInfo {
  if (!snapshot) snapshot = getNetworkInfo();
  return snapshot;
}

function getServerSnapshot(): NetworkInfo {
  return DEFAULT_INFO;
}

/** React hook: current network snapshot, updated on connectivity changes. */
export function useNetwork(): NetworkInfo {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** React hook: reactive Low Data Mode state synced across tabs and Settings. */
export function useLowDataMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isLowDataMode(),
    () => false,
  );
}
