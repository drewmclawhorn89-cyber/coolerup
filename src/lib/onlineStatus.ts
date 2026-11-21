import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  buildFirestoreErrorInfo,
  getFirebaseAuth,
  getFirebaseDb,
  getFirebasePhoneConfig,
  getFirestoreDatabaseId,
  OperationType,
} from "@/lib/firebase";

export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
export const STALE_ONLINE_THRESHOLD_MS = 6 * 60 * 1000;
export const ONLINE_DOT_COLOR = "#25D366";

const SHOW_ONLINE_STORAGE_KEY = "settings:showOnline";
const LEGACY_ACTIVITY_PREF_KEY = "pref:activity-status";
const PRESENCE_CACHE_KEY = "coolerup:presence-cache:v1";
const ONLINE_PRIVACY_EVENT = "coolerup-online-privacy";
const ONLINE_STATUS_CHANNEL = "coolerup-online-status";
const BROADCAST_CHANNEL_NAME = "coolerup-online-status-tabs";

export type UserPresenceRecord = {
  handle: string;
  isOnline: boolean;
  lastActive: number | null;
  showOnline: boolean;
};

export type VisiblePresence = {
  visible: boolean;
  isOnline: boolean;
  statusText: string | null;
};

export function normalizePresenceHandle(handle: string | null | undefined): string {
  if (!handle) return "";
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function isValidPresenceHandle(handle: string): boolean {
  return handle.length >= 1 && handle.length <= 40 && /^[a-z0-9._]+$/.test(handle);
}

/**
 * Deterministic Firestore document ID matching ^[a-zA-Z0-9_-]+$ with 1-to-1 encoding
 * for handles that may contain dots or underscores.
 */
export function presenceDocId(handle: string): string {
  const normalized = normalizePresenceHandle(handle);
  if (!normalized) return "";
  return `h_${normalized.replace(/_/g, "__").replace(/\./g, "_d_")}`;
}

export function isEffectivelyOnline(
  record: UserPresenceRecord | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!record || record.showOnline === false || !record.isOnline) return false;
  if (record.lastActive === null) return true;
  return nowMs - record.lastActive <= STALE_ONLINE_THRESHOLD_MS;
}

export function formatOfflineActivity(
  lastActiveMs: number | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (lastActiveMs === null || lastActiveMs === undefined || !Number.isFinite(lastActiveMs)) {
    return null;
  }
  const diffMs = Math.max(0, nowMs - lastActiveMs);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Active just now";
  if (diffMin < 60) return `Active ${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Active ${diffHours}h ago`;
  if (diffHours < 48) return "Active yesterday";

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Active ${diffDays}d ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  return `Active ${diffWeeks}w ago`;
}

export function formatLastActive(
  lastActiveMs: number | null,
  isOnline: boolean,
  nowMs: number = Date.now(),
): string | null {
  if (isOnline && (lastActiveMs === null || nowMs - lastActiveMs <= STALE_ONLINE_THRESHOLD_MS)) {
    return "Active now";
  }
  return formatOfflineActivity(lastActiveMs, nowMs);
}

/**
 * Applies reciprocal TikTok-style Activity Status privacy:
 * - If the viewer has "Show when I'm online" OFF, they see nothing.
 * - If the target user has "Show when I'm online" OFF, others see nothing.
 */
export function getVisiblePresence(
  target: UserPresenceRecord | null | undefined,
  viewerShowOnline: boolean,
  nowMs: number = Date.now(),
): VisiblePresence {
  if (!viewerShowOnline || !target || target.showOnline === false) {
    return { visible: false, isOnline: false, statusText: null };
  }
  if (isEffectivelyOnline(target, nowMs)) {
    return { visible: true, isOnline: true, statusText: null };
  }
  const statusText = formatOfflineActivity(target.lastActive, nowMs);
  if (!statusText) {
    return { visible: false, isOnline: false, statusText: null };
  }
  return { visible: true, isOnline: false, statusText };
}

export function readShowOnlineSetting(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const primary = window.localStorage.getItem(SHOW_ONLINE_STORAGE_KEY);
    if (primary !== null) return primary !== "false";
    const legacy = window.localStorage.getItem(LEGACY_ACTIVITY_PREF_KEY);
    if (legacy !== null) return legacy !== "false";
  } catch {
    // Ignore storage read errors in restricted browsing contexts.
  }
  return true;
}

export function writeShowOnlineSetting(showOnline: boolean): void {
  if (typeof window === "undefined") return;
  const serialized = showOnline ? "true" : "false";
  try {
    window.localStorage.setItem(SHOW_ONLINE_STORAGE_KEY, serialized);
    window.localStorage.setItem(LEGACY_ACTIVITY_PREF_KEY, serialized);
  } catch {
    // Ignore storage write errors.
  }
  window.dispatchEvent(new CustomEvent(ONLINE_PRIVACY_EVENT, { detail: showOnline }));
}

export function useShowOnlineSetting(): [boolean, (next: boolean) => void] {
  const [showOnline, setShowOnlineState] = useState<boolean>(() => readShowOnlineSetting());

  useEffect(() => {
    const sync = () => setShowOnlineState(readShowOnlineSetting());
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<boolean | undefined>).detail;
      setShowOnlineState(typeof detail === "boolean" ? detail : readShowOnlineSetting());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SHOW_ONLINE_STORAGE_KEY || event.key === LEGACY_ACTIVITY_PREF_KEY) {
        sync();
      }
    };
    window.addEventListener(ONLINE_PRIVACY_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ONLINE_PRIVACY_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = (next: boolean) => {
    setShowOnlineState(next);
    writeShowOnlineSetting(next);
  };

  return [showOnline, update];
}

// --- Shared Presence Store & Transports --------------------------------------

const presenceStore = new Map<string, UserPresenceRecord>();
const handleListeners = new Map<string, Set<() => void>>();
const firestoreCreatedDocs = new Set<string>();
let cacheHydrated = false;
let supabaseTableUnavailable = false;
let broadcastTabChannel: BroadcastChannel | null = null;
let cachedFirebaseToken: string | null = null;

function hydrateStoreFromStorage(): void {
  if (cacheHydrated || typeof window === "undefined") return;
  cacheHydrated = true;
  try {
    const raw = window.localStorage.getItem(PRESENCE_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, UserPresenceRecord> | null;
    if (!parsed || typeof parsed !== "object") return;
    for (const [k, rec] of Object.entries(parsed)) {
      const handle = normalizePresenceHandle(rec?.handle ?? k);
      if (!handle) continue;
      presenceStore.set(handle, {
        handle,
        isOnline: Boolean(rec?.isOnline),
        lastActive: typeof rec?.lastActive === "number" ? rec.lastActive : null,
        showOnline: rec?.showOnline !== false,
      });
    }
  } catch {
    // Ignore corrupt local cache.
  }
}

function persistStoreToStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const serialized: Record<string, UserPresenceRecord> = {};
    for (const [key, val] of presenceStore.entries()) {
      serialized[key] = val;
    }
    window.localStorage.setItem(PRESENCE_CACHE_KEY, JSON.stringify(serialized));
  } catch {
    // Ignore quota errors.
  }
}

function emitHandleUpdate(handle: string): void {
  const listeners = handleListeners.get(handle);
  if (!listeners) return;
  for (const fn of listeners) fn();
}

function upsertPresenceRecord(record: UserPresenceRecord, broadcastCrossTab = false): void {
  hydrateStoreFromStorage();
  const handle = normalizePresenceHandle(record.handle);
  if (!handle) return;

  const normalized: UserPresenceRecord = {
    handle,
    isOnline: record.showOnline ? Boolean(record.isOnline) : false,
    lastActive: record.lastActive,
    showOnline: record.showOnline,
  };

  const prev = presenceStore.get(handle);
  // Ignore stale updates that carry an older lastActive unless privacy flipped.
  if (
    prev &&
    prev.lastActive !== null &&
    normalized.lastActive !== null &&
    normalized.lastActive < prev.lastActive &&
    normalized.showOnline === prev.showOnline &&
    normalized.isOnline === prev.isOnline
  ) {
    return;
  }

  presenceStore.set(handle, normalized);
  persistStoreToStorage();
  emitHandleUpdate(handle);

  if (broadcastCrossTab && typeof window !== "undefined") {
    try {
      if (!broadcastTabChannel && typeof BroadcastChannel !== "undefined") {
        broadcastTabChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        broadcastTabChannel.onmessage = (msg) => {
          const data = msg.data as UserPresenceRecord | undefined;
          if (data?.handle) upsertPresenceRecord(data, false);
        };
      }
      broadcastTabChannel?.postMessage(normalized);
    } catch {
      // BroadcastChannel unavailable in restricted environments.
    }
  }
}

function subscribeHandleStore(handle: string, listener: () => void): () => void {
  hydrateStoreFromStorage();
  const normalized = normalizePresenceHandle(handle);
  if (!normalized) return () => {};
  let set = handleListeners.get(normalized);
  if (!set) {
    set = new Set();
    handleListeners.set(normalized, set);
  }
  set.add(listener);

  if (typeof window !== "undefined") {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PRESENCE_CACHE_KEY) return;
      cacheHydrated = false;
      hydrateStoreFromStorage();
      emitHandleUpdate(normalized);
    };
    window.addEventListener("storage", onStorage);
    if (!broadcastTabChannel && typeof BroadcastChannel !== "undefined") {
      try {
        broadcastTabChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        broadcastTabChannel.onmessage = (msg) => {
          const data = msg.data as UserPresenceRecord | undefined;
          if (data?.handle) upsertPresenceRecord(data, false);
        };
      } catch {
        // Ignore BroadcastChannel unavailability.
      }
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      set?.delete(listener);
      if (set && set.size === 0) handleListeners.delete(normalized);
    };
  }

  return () => {
    set?.delete(listener);
    if (set && set.size === 0) handleListeners.delete(normalized);
  };
}

// --- Supabase Realtime Presence & Broadcast Channel --------------------------

type RealtimePresencePayload = {
  handle?: string;
  isOnline?: boolean;
  lastActive?: number;
  showOnline?: boolean;
};

type SharedPresenceChannel = {
  channel: RealtimeChannel;
  refs: number;
  subscribed: boolean;
  onReady: Set<() => void>;
};

let sharedPresenceChannel: SharedPresenceChannel | null = null;
let lastTrackedPayload: RealtimePresencePayload | null = null;

function applyRealtimePresenceEntries(channel: RealtimeChannel): void {
  const state = channel.presenceState<RealtimePresencePayload>();
  const onlineNow = new Set<string>();
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      const h = normalizePresenceHandle(entry?.handle);
      if (!h) continue;
      if (entry.showOnline === false) {
        upsertPresenceRecord({
          handle: h,
          isOnline: false,
          lastActive: typeof entry.lastActive === "number" ? entry.lastActive : Date.now(),
          showOnline: false,
        });
        continue;
      }
      if (entry.isOnline) {
        onlineNow.add(h);
        upsertPresenceRecord({
          handle: h,
          isOnline: true,
          lastActive: typeof entry.lastActive === "number" ? entry.lastActive : Date.now(),
          showOnline: true,
        });
      }
    }
  }
  // Anyone previously marked online from realtime whose presence vanished
  // without a broadcast transitions cleanly to offline with lastActive = now.
  for (const [handle, existing] of presenceStore.entries()) {
    if (
      existing.isOnline &&
      !onlineNow.has(handle) &&
      existing.showOnline &&
      lastTrackedPayload?.handle !== handle
    ) {
      upsertPresenceRecord({
        handle,
        isOnline: false,
        lastActive: existing.lastActive ?? Date.now(),
        showOnline: true,
      });
    }
  }
}

function acquirePresenceChannel(presenceKey: string): SharedPresenceChannel | null {
  if (typeof window === "undefined") return null;
  if (sharedPresenceChannel) {
    sharedPresenceChannel.refs += 1;
    return sharedPresenceChannel;
  }

  const channel = supabase.channel(ONLINE_STATUS_CHANNEL, {
    config: { presence: { key: presenceKey || "anon" } },
  });
  const shared: SharedPresenceChannel = {
    channel,
    refs: 1,
    subscribed: false,
    onReady: new Set(),
  };

  channel.on("presence", { event: "sync" }, () => {
    applyRealtimePresenceEntries(channel);
  });

  channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
    const entries = (leftPresences ?? []) as unknown as RealtimePresencePayload[];
    for (const entry of entries) {
      const h = normalizePresenceHandle(entry?.handle);
      if (!h) continue;
      upsertPresenceRecord({
        handle: h,
        isOnline: false,
        lastActive: Date.now(),
        showOnline: entry.showOnline !== false,
      });
    }
  });

  channel.on("broadcast", { event: "status" }, ({ payload }) => {
    const data = payload as RealtimePresencePayload | undefined;
    const h = normalizePresenceHandle(data?.handle);
    if (!h) return;
    upsertPresenceRecord({
      handle: h,
      isOnline: Boolean(data?.isOnline),
      lastActive: typeof data?.lastActive === "number" ? data.lastActive : Date.now(),
      showOnline: data?.showOnline !== false,
    });
  });

  channel.subscribe((status: string) => {
    if (status !== "SUBSCRIBED") return;
    shared.subscribed = true;
    shared.onReady.forEach((fn) => fn());
    shared.onReady.clear();
  });

  sharedPresenceChannel = shared;
  return shared;
}

function releasePresenceChannel(shared: SharedPresenceChannel | null): void {
  if (!shared) return;
  shared.refs -= 1;
  if (shared.refs > 0) return;
  window.setTimeout(() => {
    if (shared.refs > 0) return;
    if (sharedPresenceChannel === shared) sharedPresenceChannel = null;
    void supabase.removeChannel(shared.channel);
  }, 1500);
}

// --- Firebase Firestore Persistence & Live Listener --------------------------

function parseTimestampMs(raw: unknown): number | null {
  if (raw instanceof Timestamp) return raw.toMillis();
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (raw && typeof raw === "object" && "toMillis" in raw && typeof raw.toMillis === "function") {
    const ms = raw.toMillis() as unknown;
    return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

async function writePresenceToFirestore(
  handle: string,
  isOnline: boolean,
  showOnline: boolean,
): Promise<void> {
  const fbAuth = getFirebaseAuth();
  const db = getFirebaseDb();
  const fbUser = fbAuth?.currentUser;
  if (!db || !fbUser) return;

  const normalized = normalizePresenceHandle(handle);
  if (!isValidPresenceHandle(normalized)) return;
  const docId = presenceDocId(normalized);
  if (!docId || fbUser.uid.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(fbUser.uid)) return;

  try {
    cachedFirebaseToken = await fbUser.getIdToken();
  } catch {
    // Ignore token refresh failures.
  }

  const safeOnline = showOnline ? Boolean(isOnline) : false;
  const path = `user_presence/${docId}`;
  const ref = doc(db, "user_presence", docId);

  try {
    if (!firestoreCreatedDocs.has(docId)) {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          uid: fbUser.uid,
          handle: normalized,
          isOnline: safeOnline,
          showOnline,
          lastActive: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        firestoreCreatedDocs.add(docId);
        return;
      }
      firestoreCreatedDocs.add(docId);
    }

    await updateDoc(ref, {
      isOnline: safeOnline,
      showOnline,
      lastActive: serverTimestamp(),
    });
  } catch (err) {
    const info = buildFirestoreErrorInfo(err, OperationType.WRITE, path);
    console.warn("Firestore presence write skipped:", JSON.stringify(info));
  }
}

function flushOfflineToFirestoreKeepalive(
  handle: string,
  showOnline: boolean,
  lastActiveMs: number,
): void {
  if (typeof fetch !== "function" || !cachedFirebaseToken) return;
  const cfg = getFirebasePhoneConfig();
  if (!cfg?.projectId) return;
  const normalized = normalizePresenceHandle(handle);
  const docId = presenceDocId(normalized);
  if (!docId) return;

  const dbId = encodeURIComponent(getFirestoreDatabaseId());
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${dbId}/documents/user_presence/${encodeURIComponent(docId)}?updateMask.fieldPaths=isOnline&updateMask.fieldPaths=showOnline&updateMask.fieldPaths=lastActive`;
  try {
    void fetch(url, {
      method: "PATCH",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cachedFirebaseToken}`,
      },
      body: JSON.stringify({
        fields: {
          isOnline: { booleanValue: false },
          showOnline: { booleanValue: Boolean(showOnline) },
          lastActive: { timestampValue: new Date(lastActiveMs).toISOString() },
        },
      }),
    });
  } catch {
    // Best-effort keepalive on page close.
  }
}

// --- Supabase Table Persistence (Optional, Migration-Backed) -----------------

async function writePresenceToSupabaseTable(
  userId: string | undefined,
  handle: string,
  isOnline: boolean,
  lastActiveMs: number,
  showOnline: boolean,
): Promise<void> {
  if (supabaseTableUnavailable || !userId) return;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user?.id || sessionData.session.user.id !== userId) return;
    const safeOnline = showOnline ? Boolean(isOnline) : false;
    const { error } = await (
      supabase as unknown as {
        from: (table: string) => {
          upsert: (
            row: Record<string, unknown>,
            opts: { onConflict: string },
          ) => Promise<{ error: { code?: string; message?: string } | null }>;
        };
      }
    )
      .from("user_presence")
      .upsert(
        {
          user_id: userId,
          handle: normalizePresenceHandle(handle),
          is_online: safeOnline,
          last_active: new Date(lastActiveMs).toISOString(),
          show_online: showOnline,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (error?.code === "PGRST205" || error?.code === "42P01") {
      supabaseTableUnavailable = true;
    }
  } catch {
    // Graceful no-op if Supabase migration is pending.
  }
}

async function fetchHandlesFromSupabaseTable(handles: string[]): Promise<void> {
  if (supabaseTableUnavailable || handles.length === 0) return;
  try {
    const { data, error } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            in: (
              col: string,
              vals: string[],
            ) => Promise<{
              data: Array<{
                handle?: string;
                is_online?: boolean;
                last_active?: string;
                show_online?: boolean;
              }> | null;
              error: { code?: string; message?: string } | null;
            }>;
          };
        };
      }
    )
      .from("user_presence")
      .select("handle, is_online, last_active, show_online")
      .in("handle", handles);

    if (error) {
      if (error.code === "PGRST205" || error.code === "42P01") {
        supabaseTableUnavailable = true;
      }
      return;
    }

    for (const row of data ?? []) {
      const h = normalizePresenceHandle(row.handle);
      if (!h) continue;
      upsertPresenceRecord({
        handle: h,
        isOnline: Boolean(row.is_online),
        lastActive: parseTimestampMs(row.last_active),
        showOnline: row.show_online !== false,
      });
    }
  } catch {
    // Ignore when table is unavailable.
  }
}

export type PublishPresenceInput = {
  userId?: string | undefined;
  handle: string;
  isOnline: boolean;
  lastActive: number;
  showOnline: boolean;
  keepalive?: boolean;
};

export function publishPresenceState(input: PublishPresenceInput): void {
  const handle = normalizePresenceHandle(input.handle);
  if (!handle) return;
  const effectiveOnline = input.showOnline ? Boolean(input.isOnline) : false;

  upsertPresenceRecord(
    {
      handle,
      isOnline: effectiveOnline,
      lastActive: input.lastActive,
      showOnline: input.showOnline,
    },
    true,
  );

  // Realtime WebSocket broadcast + presence tracking.
  if (sharedPresenceChannel?.subscribed) {
    const payload: RealtimePresencePayload = {
      handle,
      isOnline: effectiveOnline,
      lastActive: input.lastActive,
      showOnline: input.showOnline,
    };
    lastTrackedPayload = payload;
    if (effectiveOnline) {
      void sharedPresenceChannel.channel.track(payload);
    } else {
      void sharedPresenceChannel.channel.untrack();
    }
    void sharedPresenceChannel.channel.send({
      type: "broadcast",
      event: "status",
      payload,
    });
  }

  // Firestore persistence.
  if (input.keepalive && !effectiveOnline) {
    flushOfflineToFirestoreKeepalive(handle, input.showOnline, input.lastActive);
  } else {
    void writePresenceToFirestore(handle, effectiveOnline, input.showOnline);
  }

  // Supabase table persistence.
  void writePresenceToSupabaseTable(
    input.userId,
    handle,
    effectiveOnline,
    input.lastActive,
    input.showOnline,
  );
}

// --- Testable Activity & Inactivity Tracker ----------------------------------

export type PresenceControllerOptions = {
  inactivityMs?: number;
  heartbeatMs?: number;
  onPublish: (state: { isOnline: boolean; lastActive: number; showOnline: boolean }) => void;
  getShowOnline: () => boolean;
};

export function createPresenceActivityController({
  inactivityMs = INACTIVITY_TIMEOUT_MS,
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
  onPublish,
  getShowOnline,
}: PresenceControllerOptions) {
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let isCurrentlyOnline = false;
  let lastActivityTouchAt = 0;
  let disposed = false;

  const clearTimers = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const scheduleIdleOffline = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (disposed) return;
      isCurrentlyOnline = false;
      onPublish({
        isOnline: false,
        lastActive: Date.now(),
        showOnline: getShowOnline(),
      });
    }, inactivityMs);
  };

  const markOnline = (force = false) => {
    if (disposed) return;
    if (!getShowOnline()) {
      markOffline(false);
      return;
    }
    const now = Date.now();
    const shouldThrottle = !force && isCurrentlyOnline && now - lastActivityTouchAt < 60_000;
    lastActivityTouchAt = now;
    scheduleIdleOffline();

    if (heartbeatTimer === null) {
      heartbeatTimer = setInterval(() => {
        if (!disposed && isCurrentlyOnline && getShowOnline()) {
          onPublish({ isOnline: true, lastActive: Date.now(), showOnline: true });
        }
      }, heartbeatMs);
    }

    if (shouldThrottle) return;
    isCurrentlyOnline = true;
    onPublish({ isOnline: true, lastActive: now, showOnline: true });
  };

  const markOffline = (showOnlineValue?: boolean) => {
    if (disposed) return;
    clearTimers();
    isCurrentlyOnline = false;
    onPublish({
      isOnline: false,
      lastActive: Date.now(),
      showOnline: showOnlineValue ?? getShowOnline(),
    });
  };

  const handlePrivacyChange = (nextShowOnline: boolean) => {
    if (disposed) return;
    if (!nextShowOnline) {
      markOffline(false);
    } else {
      markOnline(true);
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimers();
  };

  return {
    markOnline,
    markOffline,
    handlePrivacyChange,
    dispose,
    get isOnline() {
      return isCurrentlyOnline;
    },
  };
}

/**
 * Mounted once inside <AuthProvider> in __root.tsx.
 * Sets status to Online on open, Offline on close or 5 minutes of inactivity,
 * and updates live across friends without refreshing.
 */
export function OnlineStatusWatcher() {
  const auth = useAuth();
  const [showOnline] = useShowOnlineSetting();
  const handle = normalizePresenceHandle(auth.handle);
  const userId = auth.user?.id;
  const activeHandleRef = useRef<string>("");

  useEffect(() => {
    if (!auth.ready || !userId || !handle) return;
    activeHandleRef.current = handle;

    const shared = acquirePresenceChannel(handle);
    const publish = (
      state: { isOnline: boolean; lastActive: number; showOnline: boolean },
      keepalive = false,
    ) => {
      publishPresenceState({
        userId,
        handle,
        isOnline: state.isOnline,
        lastActive: state.lastActive,
        showOnline: state.showOnline,
        keepalive,
      });
    };

    const controller = createPresenceActivityController({
      getShowOnline: readShowOnlineSetting,
      onPublish: (state) => publish(state, false),
    });

    if (shared) {
      const announceOnReady = () => {
        if (readShowOnlineSetting() && document.visibilityState !== "hidden") {
          controller.markOnline(true);
        } else {
          controller.markOffline(readShowOnlineSetting());
        }
      };
      if (shared.subscribed) announceOnReady();
      else shared.onReady.add(announceOnReady);
    }

    if (readShowOnlineSetting() && document.visibilityState !== "hidden") {
      controller.markOnline(true);
    } else {
      controller.markOffline(readShowOnlineSetting());
    }

    const onActivity = () => {
      if (document.visibilityState === "hidden") return;
      controller.markOnline(false);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        controller.markOffline();
      } else if (readShowOnlineSetting()) {
        controller.markOnline(true);
      }
    };

    const onClose = () => {
      const now = Date.now();
      controller.dispose();
      publish({ isOnline: false, lastActive: now, showOnline: readShowOnlineSetting() }, true);
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "pointerdown",
      "scroll",
      "focus",
    ] as const;
    for (const evt of events) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onClose);
    window.addEventListener("beforeunload", onClose);

    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onClose);
      window.removeEventListener("beforeunload", onClose);
      controller.dispose();
      publish(
        { isOnline: false, lastActive: Date.now(), showOnline: readShowOnlineSetting() },
        true,
      );
      releasePresenceChannel(shared);
      activeHandleRef.current = "";
    };
  }, [auth.ready, userId, handle]);

  useEffect(() => {
    if (!auth.ready || !userId || !handle) return;
    const now = Date.now();
    publishPresenceState({
      userId,
      handle,
      isOnline: showOnline && document.visibilityState !== "hidden",
      lastActive: now,
      showOnline,
    });
  }, [auth.ready, userId, handle, showOnline]);

  return null;
}

// --- React Hooks for Reading Live Online Status ------------------------------

export function useOnlineStatuses(handles: string[]): Record<string, VisiblePresence> {
  const [viewerShowOnline] = useShowOnlineSetting();
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const auth = useAuth();

  const normalizedHandles = useMemo(() => {
    const unique = new Set<string>();
    for (const raw of handles) {
      const n = normalizePresenceHandle(raw);
      if (n) unique.add(n);
    }
    return Array.from(unique).sort();
  }, [handles]);

  const handlesKey = normalizedHandles.join(",");

  useEffect(() => {
    const effectHandles = handlesKey ? handlesKey.split(",") : [];
    if (!viewerShowOnline || effectHandles.length === 0) return;

    const shared = acquirePresenceChannel(normalizePresenceHandle(auth.handle) || "viewer");
    const storeUnsubs = effectHandles.map((h) =>
      subscribeHandleStore(h, () => {
        setNowMs(Date.now());
        setTick((t) => t + 1);
      }),
    );

    // Fetch & subscribe to Firestore when Firebase Auth user is active.
    const db = getFirebaseDb();
    const fbUser = getFirebaseAuth()?.currentUser;
    const firestoreUnsubs: Unsubscribe[] = [];
    const myHandle = normalizePresenceHandle(auth.handle);

    if (db && fbUser) {
      for (const h of effectHandles) {
        if (!isValidPresenceHandle(h)) continue;
        if (h === myHandle) {
          const docId = presenceDocId(h);
          const path = `user_presence/${docId}`;
          firestoreUnsubs.push(
            onSnapshot(
              doc(db, "user_presence", docId),
              (snap) => {
                if (!snap.exists()) return;
                const d = snap.data();
                upsertPresenceRecord({
                  handle: normalizePresenceHandle((d["handle"] as string | undefined) ?? h),
                  isOnline: Boolean(d["isOnline"]),
                  lastActive: parseTimestampMs(d["lastActive"]),
                  showOnline: d["showOnline"] !== false,
                });
              },
              (err) => {
                const info = buildFirestoreErrorInfo(err, OperationType.GET, path);
                console.warn("Firestore self-presence listener warning:", JSON.stringify(info));
              },
            ),
          );
        } else {
          // Query filtered by showOnline == true matches security rule allow list.
          const q = query(
            collection(db, "user_presence"),
            where("handle", "==", h),
            where("showOnline", "==", true),
          );
          firestoreUnsubs.push(
            onSnapshot(
              q,
              (snap) => {
                if (snap.empty) {
                  // Peer either hasn't registered or turned privacy OFF.
                  return;
                }
                const d = snap.docs[0]?.data();
                if (!d) return;
                upsertPresenceRecord({
                  handle: normalizePresenceHandle((d["handle"] as string | undefined) ?? h),
                  isOnline: Boolean(d["isOnline"]),
                  lastActive: parseTimestampMs(d["lastActive"]),
                  showOnline: d["showOnline"] !== false,
                });
              },
              (err) => {
                const info = buildFirestoreErrorInfo(err, OperationType.LIST, "user_presence");
                console.warn("Firestore peer-presence listener warning:", JSON.stringify(info));
              },
            ),
          );
        }
      }
    }

    // Also pull persisted rows from Supabase user_presence when available.
    void fetchHandlesFromSupabaseTable(effectHandles);

    // Refresh relative timestamps ("Active 5m ago" -> "Active 6m ago") every 30s.
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);

    return () => {
      window.clearInterval(interval);
      for (const unsub of storeUnsubs) unsub();
      for (const unsub of firestoreUnsubs) unsub();
      releasePresenceChannel(shared);
    };
  }, [viewerShowOnline, handlesKey, auth.handle]);

  return useMemo(() => {
    void tick;
    const out: Record<string, VisiblePresence> = {};
    for (const h of normalizedHandles) {
      out[h] = getVisiblePresence(presenceStore.get(h), viewerShowOnline, nowMs);
    }
    return out;
  }, [normalizedHandles, viewerShowOnline, nowMs, tick]);
}

export function useOnlineStatus(handle: string | null | undefined): VisiblePresence {
  const normalized = normalizePresenceHandle(handle);
  const handles = useMemo(() => (normalized ? [normalized] : []), [normalized]);
  const map = useOnlineStatuses(handles);
  return map[normalized] ?? { visible: false, isOnline: false, statusText: null };
}

/** Testing helper to clear module presence cache between unit tests. */
export function resetPresenceCacheForTest(): void {
  presenceStore.clear();
  firestoreCreatedDocs.clear();
  cacheHydrated = false;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(PRESENCE_CACHE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }
}

/** Testing helper to seed/update cached presence records synchronously. */
export function seedPresenceRecordForTest(record: UserPresenceRecord): void {
  upsertPresenceRecord(record, false);
}
