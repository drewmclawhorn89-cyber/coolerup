import { useCallback, useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { supabase } from "@/integrations/supabase/client";
import { youtubeIdFromBrowserUrl, tiktokVideoId } from "@/lib/coolerupBrowser";
import {
  buildFirestoreErrorInfo,
  getFirebaseAuth,
  getFirebaseDb,
  OperationType,
} from "@/lib/firebase";

export const WATCH_DURATION_THRESHOLD_MS = 3000;
export const WATCH_HISTORY_RED = "#FE2C55";

export type WatchHistorySource = "foryou" | "videos" | "youtube" | "tiktok" | "instagram";

const VALID_SOURCES = new Set<WatchHistorySource>([
  "foryou",
  "videos",
  "youtube",
  "tiktok",
  "instagram",
]);

const MAX_UID_LENGTH = 128;
const MAX_DOC_ID_LENGTH = 128;
const MAX_VIDEO_ID_LENGTH = 180;
const MAX_TITLE_LENGTH = 300;
const MAX_CREATOR_LENGTH = 100;
const MAX_URL_LENGTH = 1000;
const MAX_WATCH_ROUTE_ID_LENGTH = 180;
const MAX_YOUTUBE_ID_LENGTH = 64;
const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;

const HISTORY_STORAGE_PREFIX = "coolerup:watch-history:v1:";
const SAVE_SETTING_PREFIX = "coolerup:watch-history-setting:v1:";
const WATCH_HISTORY_EVENT = "coolerup-watch-history-changed";
const WATCH_SETTING_EVENT = "coolerup-watch-history-setting-changed";

export type WatchHistoryItem = {
  id: string;
  uid: string;
  videoId: string;
  source: WatchHistorySource;
  title: string;
  creator: string;
  thumbnailUrl: string;
  videoUrl: string;
  sourceUrl: string;
  watchRouteId: string;
  youtubeId: string;
  watchedAt: number;
  createdAt: number;
};

export type RecordWatchHistoryInput = {
  videoId: string;
  source: WatchHistorySource;
  title?: string | null | undefined;
  creator?: string | null | undefined;
  thumbnailUrl?: string | null | undefined;
  videoUrl?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  watchRouteId?: string | null | undefined;
  youtubeId?: string | null | undefined;
};

let supabaseWatchTableUnavailable = false;
const firestoreKnownDocIds = new Set<string>();
const userMutationEpoch = new Map<string, number>();

function getMutationEpoch(userId: string): number {
  return userMutationEpoch.get(userId) ?? 0;
}

function bumpMutationEpoch(userId: string): void {
  userMutationEpoch.set(userId, getMutationEpoch(userId) + 1);
}

function isValidUid(uid: string | null | undefined): uid is string {
  return Boolean(uid && uid.length >= 1 && uid.length <= MAX_UID_LENGTH && VALID_ID_RE.test(uid));
}

function clampString(value: string | null | undefined, maxLen: number): string {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function hashPair(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}_${h2.toString(36)}`;
}

/**
 * Deterministic document ID (`^[a-zA-Z0-9_-]+$`, `<= 128` chars) keyed to
 * account + source + videoId so rewatching the same video updates its
 * `watchedAt` timestamp and moves it back to the top ("newest first").
 */
export function encodeWatchHistoryId(
  uid: string,
  source: WatchHistorySource,
  videoId: string,
): string {
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "user";
  const digest = hashPair(`${uid}|${source}|${videoId}`);
  return `wh_${safeUid}_${digest}`.slice(0, MAX_DOC_ID_LENGTH);
}

export function sanitizeWatchPayload(
  uid: string,
  input: RecordWatchHistoryInput,
): Omit<WatchHistoryItem, "id" | "watchedAt" | "createdAt"> | null {
  if (!isValidUid(uid)) return null;
  if (!VALID_SOURCES.has(input.source)) return null;
  const videoId = clampString(input.videoId, MAX_VIDEO_ID_LENGTH);
  if (!videoId) return null;

  const rawTitle = clampString(input.title, MAX_TITLE_LENGTH);
  const rawCreator = clampString(input.creator, MAX_CREATOR_LENGTH).replace(/^@/, "");
  const fallbackTitle =
    input.source === "tiktok"
      ? "TikTok Video"
      : input.source === "instagram"
        ? "Instagram Video"
        : input.source === "youtube"
          ? "YouTube Video"
          : "Coolerup Video";

  const title = rawTitle || fallbackTitle;
  const creator =
    rawCreator ||
    (input.source === "foryou" || input.source === "videos" ? "creator" : input.source);
  const thumbnailUrl = clampString(input.thumbnailUrl, MAX_URL_LENGTH);
  const videoUrl = clampString(input.videoUrl, MAX_URL_LENGTH);
  const sourceUrl = clampString(input.sourceUrl, MAX_URL_LENGTH);
  const watchRouteId = clampString(input.watchRouteId, MAX_WATCH_ROUTE_ID_LENGTH);
  const youtubeId = clampString(input.youtubeId, MAX_YOUTUBE_ID_LENGTH);

  return {
    uid,
    videoId,
    source: input.source,
    title,
    creator,
    thumbnailUrl,
    videoUrl,
    sourceUrl,
    watchRouteId,
    youtubeId,
  };
}

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

export function formatWatchedWhen(watchedAtMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(watchedAtMs) || watchedAtMs <= 0) return "Recently";
  const diffMs = Math.max(0, nowMs - watchedAtMs);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffHours < 48) return "Yesterday";

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const d = new Date(watchedAtMs);
  const nowYear = new Date(nowMs).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== nowYear ? { year: "numeric" } : {}),
  });
}

export function sourceLabel(source: WatchHistorySource): string {
  switch (source) {
    case "foryou":
      return "For You";
    case "videos":
      return "Videos";
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
  }
}

/**
 * Extracts structured video metadata when a user watches an external YouTube,
 * TikTok, or Instagram video inside Coolerup Browser.
 */
export function detectExternalVideoSource(rawUrl: string): RecordWatchHistoryInput | null {
  if (!rawUrl || rawUrl.startsWith("coolerup://")) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;

  // 1. YouTube
  const ytId = youtubeIdFromBrowserUrl(rawUrl);
  if (ytId) {
    return {
      videoId: `yt:${ytId}`,
      source: "youtube",
      title: path.startsWith("/shorts/") ? "YouTube Short" : "YouTube Video",
      creator: "YouTube",
      thumbnailUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      sourceUrl: rawUrl,
      youtubeId: ytId,
    };
  }

  // 2. TikTok
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const ttId = tiktokVideoId(rawUrl);
    const authorMatch = /\/@([a-zA-Z0-9._-]+)/.exec(path);
    const creator = authorMatch?.[1] ?? "tiktok";
    const isVideoPage =
      Boolean(ttId) ||
      host === "vm.tiktok.com" ||
      host === "vt.tiktok.com" ||
      path.startsWith("/t/") ||
      path.startsWith("/foryou");
    if (!isVideoPage) return null;

    return {
      videoId: ttId ? `tt:${ttId}` : `tt:${hashPair(rawUrl)}`,
      source: "tiktok",
      title: authorMatch?.[1] ? `TikTok by @${authorMatch[1]}` : "TikTok Video",
      creator,
      sourceUrl: rawUrl,
    };
  }

  // 3. Instagram
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const reelMatch =
      /^\/(?:([a-zA-Z0-9._-]+)\/)?(reel|reels|p|tv)(?:\/([a-zA-Z0-9_-]+))?\/?/i.exec(path);
    if (!reelMatch) return null;
    const creator = reelMatch[1] ?? "instagram";
    const kind = (reelMatch[2] ?? "reel").toLowerCase();
    const shortcode = reelMatch[3];
    if (!shortcode && kind !== "reels") return null;

    return {
      videoId: shortcode ? `ig:${shortcode}` : `ig:${hashPair(rawUrl)}`,
      source: "instagram",
      title:
        kind === "reel" || kind === "reels"
          ? reelMatch[1]
            ? `Instagram Reel by @${reelMatch[1]}`
            : "Instagram Reel"
          : "Instagram Video",
      creator,
      sourceUrl: rawUrl,
    };
  }

  return null;
}

// --- Active Playback > 3s Tracker (Pure & Unit-Testable) -------------------

export type WatchDurationTrackerOptions = {
  thresholdMs?: number;
  onTrigger: () => void;
  now?: () => number;
};

export function createWatchDurationTracker({
  thresholdMs = WATCH_DURATION_THRESHOLD_MS,
  onTrigger,
  now = () => Date.now(),
}: WatchDurationTrackerOptions) {
  let accumulatedMs = 0;
  let activeStartMs: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let triggered = false;
  let disposed = false;

  const clearTimer = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const getElapsedMs = () => {
    if (activeStartMs === null) return accumulatedMs;
    return accumulatedMs + Math.max(0, now() - activeStartMs);
  };

  const tryFire = () => {
    if (triggered || disposed) return false;
    if (getElapsedMs() > thresholdMs) {
      triggered = true;
      clearTimer();
      activeStartMs = null;
      onTrigger();
      return true;
    }
    return false;
  };

  const scheduleCheck = () => {
    clearTimer();
    if (triggered || disposed || activeStartMs === null) return;
    const remainingMs = Math.max(1, thresholdMs - getElapsedMs() + 20);
    timerId = setTimeout(() => {
      timerId = null;
      if (!tryFire() && activeStartMs !== null && !triggered && !disposed) {
        scheduleCheck();
      }
    }, remainingMs);
  };

  return {
    start() {
      if (disposed || triggered) return;
      if (activeStartMs === null) {
        activeStartMs = now();
      }
      if (!tryFire()) {
        scheduleCheck();
      }
    },
    pause() {
      if (activeStartMs !== null) {
        accumulatedMs += Math.max(0, now() - activeStartMs);
        activeStartMs = null;
      }
      clearTimer();
    },
    tick() {
      return tryFire();
    },
    reset() {
      clearTimer();
      accumulatedMs = 0;
      activeStartMs = null;
      triggered = false;
    },
    dispose() {
      disposed = true;
      clearTimer();
      activeStartMs = null;
    },
    getElapsedMs,
    hasTriggered() {
      return triggered;
    },
  };
}

// --- Account-Scoped Local Cache (Preserved Across Logout) --------------------

function historyStorageKey(userId: string): string {
  return `${HISTORY_STORAGE_PREFIX}${userId}`;
}

function settingStorageKey(userId: string): string {
  return `${SAVE_SETTING_PREFIX}${userId}`;
}

function readCachedHistory(userId: string): WatchHistoryItem[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(historyStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: WatchHistoryItem[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<WatchHistoryItem>;
      if (!e.id || !e.videoId || !e.source || !VALID_SOURCES.has(e.source)) continue;
      items.push({
        id: String(e.id),
        uid: String(e.uid ?? userId),
        videoId: String(e.videoId),
        source: e.source,
        title: String(e.title ?? ""),
        creator: String(e.creator ?? ""),
        thumbnailUrl: String(e.thumbnailUrl ?? ""),
        videoUrl: String(e.videoUrl ?? ""),
        sourceUrl: String(e.sourceUrl ?? ""),
        watchRouteId: String(e.watchRouteId ?? ""),
        youtubeId: String(e.youtubeId ?? ""),
        watchedAt: typeof e.watchedAt === "number" ? e.watchedAt : 0,
        createdAt: typeof e.createdAt === "number" ? e.createdAt : 0,
      });
    }
    return sortNewestFirst(items);
  } catch {
    return [];
  }
}

function writeCachedHistory(userId: string, items: WatchHistoryItem[]): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const sorted = sortNewestFirst(items).slice(0, 500);
    window.localStorage.setItem(historyStorageKey(userId), JSON.stringify(sorted));
  } catch {
    // Ignore storage quota errors in restricted browsing contexts.
  }
}

export function sortNewestFirst(items: WatchHistoryItem[]): WatchHistoryItem[] {
  return [...items].sort((a, b) => {
    if (b.watchedAt !== a.watchedAt) return b.watchedAt - a.watchedAt;
    return b.createdAt - a.createdAt;
  });
}

function emitHistoryChanged(userId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WATCH_HISTORY_EVENT, { detail: { userId } }));
}

function emitSettingChanged(userId: string, enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WATCH_SETTING_EVENT, { detail: { userId, enabled } }));
}

// --- Save Watch History ON/OFF Setting (Account-Scoped) ----------------------

export function readSaveWatchHistory(userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(settingStorageKey(userId));
    if (raw === "false") return false;
    if (raw === "true") return true;
  } catch {
    // Ignore storage errors.
  }
  return true;
}

function cacheSaveWatchHistoryLocal(userId: string, enabled: boolean): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(settingStorageKey(userId), enabled ? "true" : "false");
  } catch {
    // Ignore storage quota errors.
  }
}

export async function fetchSaveWatchHistorySetting(userId: string): Promise<boolean> {
  if (!isValidUid(userId)) return readSaveWatchHistory(userId);

  // 1. Firestore (when Firebase Auth matches this user)
  const fbUser = getFirebaseAuth()?.currentUser;
  const db = getFirebaseDb();
  if (fbUser && fbUser.uid === userId && db) {
    try {
      const snap = await getDoc(doc(db, "watch_history_settings", userId));
      if (snap.exists()) {
        const data = snap.data() as { saveWatchHistory?: unknown };
        if (typeof data.saveWatchHistory === "boolean") {
          cacheSaveWatchHistoryLocal(userId, data.saveWatchHistory);
          return data.saveWatchHistory;
        }
      }
    } catch (err) {
      const info = buildFirestoreErrorInfo(
        err,
        OperationType.GET,
        `watch_history_settings/${userId}`,
      );
      console.warn("Watch history setting fetch skipped:", JSON.stringify(info));
    }
  }

  // 2. Supabase (when Supabase Auth matches this user)
  if (!supabaseWatchTableUnavailable) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id === userId) {
        const { data, error } = await (
          supabase as unknown as {
            from: (table: string) => {
              select: (cols: string) => {
                eq: (
                  col: string,
                  val: string,
                ) => {
                  maybeSingle: () => Promise<{
                    data: { save_watch_history?: boolean } | null;
                    error: { code?: string; message?: string } | null;
                  }>;
                };
              };
            };
          }
        )
          .from("watch_history_settings")
          .select("save_watch_history")
          .eq("user_id", userId)
          .maybeSingle();

        if (error && (error.code === "PGRST205" || error.code === "42P01")) {
          supabaseWatchTableUnavailable = true;
        } else if (data && typeof data.save_watch_history === "boolean") {
          cacheSaveWatchHistoryLocal(userId, data.save_watch_history);
          return data.save_watch_history;
        }
      }
    } catch {
      // Fallback to cached setting if Supabase table isn't provisioned yet.
    }
  }

  return readSaveWatchHistory(userId);
}

export async function writeSaveWatchHistory(
  userId: string | null | undefined,
  enabled: boolean,
): Promise<void> {
  if (!userId) return;
  const next = Boolean(enabled);
  cacheSaveWatchHistoryLocal(userId, next);
  emitSettingChanged(userId, next);

  // Sync to Firestore when signed in via Firebase
  const fbUser = getFirebaseAuth()?.currentUser;
  const db = getFirebaseDb();
  if (fbUser && fbUser.uid === userId && db && isValidUid(userId)) {
    const path = `watch_history_settings/${userId}`;
    try {
      await setDoc(doc(db, "watch_history_settings", userId), {
        uid: userId,
        saveWatchHistory: next,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      const info = buildFirestoreErrorInfo(err, OperationType.WRITE, path);
      console.warn("Firestore watch history setting write skipped:", JSON.stringify(info));
    }
  }

  // Sync to Supabase when signed in via Supabase
  if (!supabaseWatchTableUnavailable) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id === userId) {
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
          .from("watch_history_settings")
          .upsert(
            {
              user_id: userId,
              save_watch_history: next,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (error && (error.code === "PGRST205" || error.code === "42P01")) {
          supabaseWatchTableUnavailable = true;
        }
      }
    } catch {
      // Best-effort sync.
    }
  }
}

export function useSaveWatchHistorySetting(
  userId: string | null | undefined,
): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() =>
    userId ? readSaveWatchHistory(userId) : true,
  );

  useEffect(() => {
    if (!userId) {
      setEnabled(true);
      return;
    }
    let alive = true;
    setEnabled(readSaveWatchHistory(userId));
    void fetchSaveWatchHistorySetting(userId).then((remote) => {
      if (alive) setEnabled(remote);
    });

    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; enabled?: boolean }>).detail;
      if (detail?.userId === userId && typeof detail.enabled === "boolean") {
        setEnabled(detail.enabled);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === settingStorageKey(userId)) {
        setEnabled(readSaveWatchHistory(userId));
      }
    };

    window.addEventListener(WATCH_SETTING_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      alive = false;
      window.removeEventListener(WATCH_SETTING_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  const update = useCallback(
    (next: boolean) => {
      if (!userId) return;
      setEnabled(next);
      void writeSaveWatchHistory(userId, next);
    },
    [userId],
  );

  return [enabled, update];
}

// --- CRUD: Record, List, Delete One, Clear All -------------------------------

export async function recordWatchHistory(
  userId: string | null | undefined,
  input: RecordWatchHistoryInput,
): Promise<WatchHistoryItem | null> {
  if (!isValidUid(userId)) return null;
  if (!readSaveWatchHistory(userId)) return null;

  const clean = sanitizeWatchPayload(userId, input);
  if (!clean) return null;

  const docId = encodeWatchHistoryId(userId, clean.source, clean.videoId);
  const now = Date.now();
  const existing = readCachedHistory(userId).find((item) => item.id === docId);

  const entry: WatchHistoryItem = {
    ...clean,
    id: docId,
    watchedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  // Update account-scoped local cache immediately
  bumpMutationEpoch(userId);
  const cached = readCachedHistory(userId).filter((item) => item.id !== docId);
  writeCachedHistory(userId, [entry, ...cached]);
  emitHistoryChanged(userId);

  // Sync to Firestore when Firebase user matches
  const fbUser = getFirebaseAuth()?.currentUser;
  const db = getFirebaseDb();
  if (fbUser && fbUser.uid === userId && db) {
    const path = `watch_history/${docId}`;
    const ref = doc(db, "watch_history", docId);
    try {
      let exists = firestoreKnownDocIds.has(docId);
      if (!exists) {
        const snap = await getDoc(ref);
        exists = snap.exists();
        if (exists) firestoreKnownDocIds.add(docId);
      }

      if (!exists) {
        await setDoc(ref, {
          ...clean,
          watchedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
        firestoreKnownDocIds.add(docId);
      } else {
        await updateDoc(ref, {
          videoId: clean.videoId,
          source: clean.source,
          title: clean.title,
          creator: clean.creator,
          thumbnailUrl: clean.thumbnailUrl,
          videoUrl: clean.videoUrl,
          sourceUrl: clean.sourceUrl,
          watchRouteId: clean.watchRouteId,
          youtubeId: clean.youtubeId,
          watchedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      const info = buildFirestoreErrorInfo(err, OperationType.WRITE, path);
      console.warn("Firestore watch history write skipped:", JSON.stringify(info));
    }
  }

  // Sync to Supabase when Supabase session matches
  if (!supabaseWatchTableUnavailable) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id === userId) {
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
          .from("watch_history")
          .upsert(
            {
              id: docId,
              user_id: userId,
              video_id: clean.videoId,
              source: clean.source,
              title: clean.title,
              creator: clean.creator,
              thumbnail_url: clean.thumbnailUrl,
              video_url: clean.videoUrl,
              source_url: clean.sourceUrl,
              watch_route_id: clean.watchRouteId,
              youtube_id: clean.youtubeId,
              watched_at: new Date(now).toISOString(),
            },
            { onConflict: "user_id,source,video_id" },
          );
        if (error && (error.code === "PGRST205" || error.code === "42P01")) {
          supabaseWatchTableUnavailable = true;
        }
      }
    } catch {
      // Best-effort sync.
    }
  }

  return entry;
}

export async function listWatchHistory(
  userId: string | null | undefined,
): Promise<WatchHistoryItem[]> {
  if (!isValidUid(userId)) return [];
  const startEpoch = getMutationEpoch(userId);

  const merged = new Map<string, WatchHistoryItem>();
  for (const item of readCachedHistory(userId)) {
    merged.set(item.id, item);
  }

  // 1. Read from Firestore (single-field `where("uid", "==", ...)` needs no composite index)
  const fbUser = getFirebaseAuth()?.currentUser;
  const db = getFirebaseDb();
  if (fbUser && fbUser.uid === userId && db) {
    try {
      const q = query(collection(db, "watch_history"), where("uid", "==", userId));
      const snap = await getDocs(q);
      snap.forEach((d) => {
        const raw = d.data() as Record<string, unknown>;
        const source = raw["source"] as WatchHistorySource | undefined;
        if (!source || !VALID_SOURCES.has(source)) return;
        const watchedAt = parseTimestampMs(raw["watchedAt"]) ?? 0;
        const createdAt = parseTimestampMs(raw["createdAt"]) ?? watchedAt;
        firestoreKnownDocIds.add(d.id);

        const nextItem: WatchHistoryItem = {
          id: d.id,
          uid: String(raw["uid"] ?? userId),
          videoId: String(raw["videoId"] ?? ""),
          source,
          title: String(raw["title"] ?? ""),
          creator: String(raw["creator"] ?? ""),
          thumbnailUrl: String(raw["thumbnailUrl"] ?? ""),
          videoUrl: String(raw["videoUrl"] ?? ""),
          sourceUrl: String(raw["sourceUrl"] ?? ""),
          watchRouteId: String(raw["watchRouteId"] ?? ""),
          youtubeId: String(raw["youtubeId"] ?? ""),
          watchedAt,
          createdAt,
        };
        const existing = merged.get(d.id);
        if (!existing || nextItem.watchedAt >= existing.watchedAt) {
          merged.set(d.id, nextItem);
        }
      });
    } catch (err) {
      const info = buildFirestoreErrorInfo(err, OperationType.LIST, "watch_history");
      console.warn("Firestore watch history read skipped:", JSON.stringify(info));
    }
  }

  // 2. Read from Supabase when Supabase session matches
  if (!supabaseWatchTableUnavailable) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id === userId) {
        const { data, error } = await (
          supabase as unknown as {
            from: (table: string) => {
              select: (cols: string) => {
                eq: (
                  col: string,
                  val: string,
                ) => {
                  order: (
                    col: string,
                    opts: { ascending: boolean },
                  ) => {
                    limit: (n: number) => Promise<{
                      data: Array<Record<string, unknown>> | null;
                      error: { code?: string; message?: string } | null;
                    }>;
                  };
                };
              };
            };
          }
        )
          .from("watch_history")
          .select(
            "id, user_id, video_id, source, title, creator, thumbnail_url, video_url, source_url, watch_route_id, youtube_id, watched_at, created_at",
          )
          .eq("user_id", userId)
          .order("watched_at", { ascending: false })
          .limit(200);

        if (error) {
          if (error.code === "PGRST205" || error.code === "42P01") {
            supabaseWatchTableUnavailable = true;
          }
        } else {
          for (const raw of data ?? []) {
            const source = raw["source"] as WatchHistorySource | undefined;
            if (!source || !VALID_SOURCES.has(source)) continue;
            const id = String(raw["id"] ?? "");
            if (!id) continue;
            const watchedAt = parseTimestampMs(raw["watched_at"]) ?? 0;
            const createdAt = parseTimestampMs(raw["created_at"]) ?? watchedAt;
            const nextItem: WatchHistoryItem = {
              id,
              uid: String(raw["user_id"] ?? userId),
              videoId: String(raw["video_id"] ?? ""),
              source,
              title: String(raw["title"] ?? ""),
              creator: String(raw["creator"] ?? ""),
              thumbnailUrl: String(raw["thumbnail_url"] ?? ""),
              videoUrl: String(raw["video_url"] ?? ""),
              sourceUrl: String(raw["source_url"] ?? ""),
              watchRouteId: String(raw["watch_route_id"] ?? ""),
              youtubeId: String(raw["youtube_id"] ?? ""),
              watchedAt,
              createdAt,
            };
            const existing = merged.get(id);
            if (!existing || nextItem.watchedAt >= existing.watchedAt) {
              merged.set(id, nextItem);
            }
          }
        }
      }
    } catch {
      // Keep local/Firestore items on network failure.
    }
  }

  if (getMutationEpoch(userId) !== startEpoch) {
    return readCachedHistory(userId);
  }

  const sorted = sortNewestFirst(Array.from(merged.values()));
  writeCachedHistory(userId, sorted);
  return sorted;
}

export async function removeWatchHistoryItem(
  userId: string | null | undefined,
  historyId: string,
): Promise<void> {
  if (!isValidUid(userId) || !historyId) return;

  bumpMutationEpoch(userId);
  const remaining = readCachedHistory(userId).filter((item) => item.id !== historyId);
  writeCachedHistory(userId, remaining);
  firestoreKnownDocIds.delete(historyId);
  emitHistoryChanged(userId);

  const fbUser = getFirebaseAuth()?.currentUser;
  const db = getFirebaseDb();
  if (fbUser && fbUser.uid === userId && db) {
    const path = `watch_history/${historyId}`;
    try {
      await deleteDoc(doc(db, "watch_history", historyId));
    } catch (err) {
      const info = buildFirestoreErrorInfo(err, OperationType.DELETE, path);
      console.warn("Firestore watch history delete skipped:", JSON.stringify(info));
    }
  }

  if (!supabaseWatchTableUnavailable) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id === userId) {
        const { error } = await (
          supabase as unknown as {
            from: (table: string) => {
              delete: () => {
                eq: (
                  col: string,
                  val: string,
                ) => {
                  eq: (
                    col: string,
                    val: string,
                  ) => Promise<{ error: { code?: string; message?: string } | null }>;
                };
              };
            };
          }
        )
          .from("watch_history")
          .delete()
          .eq("id", historyId)
          .eq("user_id", userId);

        if (error && (error.code === "PGRST205" || error.code === "42P01")) {
          supabaseWatchTableUnavailable = true;
        }
      }
    } catch {
      // Best-effort sync.
    }
  }
}

export async function clearWatchHistory(userId: string | null | undefined): Promise<void> {
  if (!isValidUid(userId)) return;

  bumpMutationEpoch(userId);
  const previous = readCachedHistory(userId);
  for (const item of previous) {
    firestoreKnownDocIds.delete(item.id);
  }
  writeCachedHistory(userId, []);
  emitHistoryChanged(userId);

  const fbUser = getFirebaseAuth()?.currentUser;
  const db = getFirebaseDb();
  if (fbUser && fbUser.uid === userId && db) {
    try {
      const q = query(collection(db, "watch_history"), where("uid", "==", userId));
      const snap = await getDocs(q);
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        for (const d of docs.slice(i, i + 400)) {
          firestoreKnownDocIds.delete(d.id);
          batch.delete(d.ref);
        }
        await batch.commit();
      }
    } catch (err) {
      const info = buildFirestoreErrorInfo(err, OperationType.DELETE, "watch_history");
      console.warn("Firestore watch history clear skipped:", JSON.stringify(info));
    }
  }

  if (!supabaseWatchTableUnavailable) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id === userId) {
        const { error } = await (
          supabase as unknown as {
            from: (table: string) => {
              delete: () => {
                eq: (
                  col: string,
                  val: string,
                ) => Promise<{ error: { code?: string; message?: string } | null }>;
              };
            };
          }
        )
          .from("watch_history")
          .delete()
          .eq("user_id", userId);

        if (error && (error.code === "PGRST205" || error.code === "42P01")) {
          supabaseWatchTableUnavailable = true;
        }
      }
    } catch {
      // Best-effort sync.
    }
  }
}

export function useWatchHistory(userId: string | null | undefined) {
  const [items, setItems] = useState<WatchHistoryItem[]>(() =>
    isValidUid(userId) ? readCachedHistory(userId) : [],
  );
  const [loading, setLoading] = useState<boolean>(() => Boolean(userId));

  const reload = useCallback(async () => {
    if (!isValidUid(userId)) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await listWatchHistory(userId);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!isValidUid(userId)) {
      setItems([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setItems(readCachedHistory(userId));
    setLoading(true);
    void listWatchHistory(userId).then((list) => {
      if (alive) {
        setItems(list);
        setLoading(false);
      }
    });

    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (!detail?.userId || detail.userId === userId) {
        setItems(readCachedHistory(userId));
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === historyStorageKey(userId)) {
        setItems(readCachedHistory(userId));
      }
    };

    window.addEventListener(WATCH_HISTORY_EVENT, onChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      alive = false;
      window.removeEventListener(WATCH_HISTORY_EVENT, onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  return { items, loading, reload };
}
