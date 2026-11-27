import { supabase } from "@/integrations/supabase/client";
import { resolveMediaUrl } from "@/lib/media";
import { detectExternalWatermark } from "@/lib/smartWatermark";
import { untypedDb } from "@/lib/untypedDb";
import {
  downloadExtension,
  prepareWatermarkedFile,
  saveFileToDisk,
  type WatermarkProgress,
} from "@/lib/watermark";

export type DmMediaType = "image" | "video" | "coolerup_video";

export type DirectMessage = {
  id: string;
  from_id?: string | null | undefined;
  to_id?: string | null | undefined;
  from_username: string;
  to_username: string;
  message: string;
  gif_url: string | null;
  gif_credit: string | null;
  media_url: string | null;
  media_type: DmMediaType | null;
  media_video_id: string | null;
  media_caption: string | null;
  media_has_external_watermark: boolean;
  view_once: boolean;
  view_once_opened_at: string | null;
  deleted_by_sender?: boolean;
  deleted_by_recipient?: boolean;
  created_at: string;
};

export type DmMediaPermission = {
  allowed: boolean;
  isFollower: boolean;
  allowEveryone: boolean;
  recipientId: string | null;
  recipientHandle: string;
  reason?: string;
};

export type CoolerupVideoChoice = {
  id: string;
  username: string;
  poster_username?: string | null;
  caption: string;
  video_url: string;
  has_external_watermark?: boolean | null;
  likes_count?: number;
};

/**
 * DM pics and videos go to `direct-messages` when that bucket exists.
 * If it does not (a project that never provisioned it), we fall back to the
 * `videos` bucket under a `dm/` folder — that bucket already works for posting.
 * No other bucket name is ever used.
 */
export const DM_MEDIA_BUCKET = "direct-messages";
export const DM_FALLBACK_BUCKET = "videos";
const DM_FOLDER = "dm";
/** Legacy values written by the old private `dm-media` bucket. */
const DM_MEDIA_PREFIX = "dm-media:";
const ALLOW_MESSAGES_FROM_EVERYONE_KEY = "allowMessagesFromEveryone";
const OPENED_ONCE_LOCAL_KEY = "coolerup:dm-opened-once:v1";
const DELETED_DM_LOCAL_KEY = "coolerup:dm-deleted:v1";

const MAX_DM_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MiB
const MAX_DM_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MiB

const DM_META_RE = /\s*\[\[dm:([^\]]+)\]\]\s*$/;

const signedDmUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Remember whether the connected DB already has the 20261226000000 columns
 * so an unmigrated database never logs repeated 400 schema errors.
 */
let extendedDmSchemaSupported: boolean | null = null;

type EncodedDmMeta = {
  u: string;
  t: DmMediaType;
  v?: string | undefined;
  c?: string | undefined;
  w?: 1 | undefined;
  o?: 1 | undefined;
};

function encodeDmMeta(meta: EncodedDmMeta): string {
  const json = JSON.stringify(meta);
  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return encodeURIComponent(json);
}

function decodeDmMeta(token: string): EncodedDmMeta | null {
  try {
    let json = "";
    if (typeof atob === "function" && !token.startsWith("%7B")) {
      const bin = atob(token);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      json = new TextDecoder().decode(bytes);
    } else {
      json = decodeURIComponent(token);
    }
    const parsed = JSON.parse(json) as Partial<EncodedDmMeta>;
    if (!parsed || typeof parsed.u !== "string") return null;
    const t: DmMediaType =
      parsed.t === "video" || parsed.t === "coolerup_video" ? parsed.t : "image";
    return {
      u: parsed.u,
      t,
      v: typeof parsed.v === "string" ? parsed.v : undefined,
      c: typeof parsed.c === "string" ? parsed.c : undefined,
      w: parsed.w === 1 ? 1 : undefined,
      o: parsed.o === 1 ? 1 : undefined,
    };
  } catch {
    return null;
  }
}

export function withLegacyDmMediaMessage(
  text: string,
  meta: {
    mediaUrl: string;
    mediaType: DmMediaType;
    mediaVideoId?: string | null | undefined;
    mediaCaption?: string | null | undefined;
    mediaHasExternalWatermark?: boolean | undefined;
    viewOnce?: boolean | undefined;
  },
): string {
  const payload: EncodedDmMeta = {
    u: meta.mediaUrl,
    t: meta.mediaType,
    ...(meta.mediaVideoId ? { v: meta.mediaVideoId } : {}),
    ...(meta.mediaCaption ? { c: meta.mediaCaption.slice(0, 140) } : {}),
    ...(meta.mediaHasExternalWatermark ? { w: 1 as const } : {}),
    ...(meta.viewOnce ? { o: 1 as const } : {}),
  };
  const tag = `[[dm:${encodeDmMeta(payload)}]]`;
  const cleanText = text.trim();
  if (!cleanText) return tag;
  const maxBody = Math.max(0, 2000 - tag.length - 1);
  return `${cleanText.slice(0, maxBody)} ${tag}`.trim();
}

function cleanHandle(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function isMissingColumnOrSchemaError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

export function getOpenedViewOnceIdsLocal(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(OPENED_ONCE_LOCAL_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

export function markViewOnceOpenedLocal(messageId: string): void {
  if (typeof window === "undefined" || !messageId) return;
  try {
    const next = Array.from(new Set([...getOpenedViewOnceIdsLocal(), messageId])).slice(-200);
    window.localStorage.setItem(OPENED_ONCE_LOCAL_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage quota */
  }
}

function getDeletedDmIdsLocal(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DELETED_DM_LOCAL_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function markDmDeletedLocal(messageId: string): void {
  if (typeof window === "undefined" || !messageId) return;
  try {
    const next = Array.from(new Set([...getDeletedDmIdsLocal(), messageId])).slice(-400);
    window.localStorage.setItem(DELETED_DM_LOCAL_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage quota */
  }
}

export function isViewOnceExpired(
  msg: Pick<DirectMessage, "id" | "view_once" | "view_once_opened_at" | "media_url">,
): boolean {
  if (!msg.view_once) return false;
  if (msg.view_once_opened_at) return true;
  if (!msg.media_url) return true;
  return getOpenedViewOnceIdsLocal().has(msg.id);
}

export function normalizeDmRow(row: Record<string, unknown>): DirectMessage {
  const id = String(row["id"] ?? "");
  let message = String(row["message"] ?? "");
  let mediaUrl = typeof row["media_url"] === "string" ? row["media_url"] : null;
  const rawType = row["media_type"];
  let mediaType: DmMediaType | null =
    rawType === "image" || rawType === "video" || rawType === "coolerup_video" ? rawType : null;
  let mediaVideoId = typeof row["media_video_id"] === "string" ? row["media_video_id"] : null;
  let mediaCaption = typeof row["media_caption"] === "string" ? row["media_caption"] : null;
  let mediaHasExternalWatermark = Boolean(row["media_has_external_watermark"]);
  let viewOnce = Boolean(row["view_once"]);

  const match = message.match(DM_META_RE);
  if (match?.[1]) {
    const parsed = decodeDmMeta(match[1]);
    message = message.replace(DM_META_RE, "").trim();
    if (parsed) {
      if (!mediaUrl) mediaUrl = parsed.u;
      if (!mediaType) mediaType = parsed.t;
      if (!mediaVideoId && parsed.v) mediaVideoId = parsed.v;
      if (!mediaCaption && parsed.c) mediaCaption = parsed.c;
      if (!mediaHasExternalWatermark && parsed.w === 1) mediaHasExternalWatermark = true;
      if (!viewOnce && parsed.o === 1) viewOnce = true;
    }
  }

  const locallyOpened = viewOnce && getOpenedViewOnceIdsLocal().has(id);
  const openedAt =
    typeof row["view_once_opened_at"] === "string"
      ? row["view_once_opened_at"]
      : locallyOpened
        ? new Date().toISOString()
        : null;

  return {
    id,
    from_id: typeof row["from_id"] === "string" ? row["from_id"] : null,
    to_id: typeof row["to_id"] === "string" ? row["to_id"] : null,
    from_username: String(row["from_username"] ?? ""),
    to_username: String(row["to_username"] ?? ""),
    message,
    gif_url: typeof row["gif_url"] === "string" ? row["gif_url"] : null,
    gif_credit: typeof row["gif_credit"] === "string" ? row["gif_credit"] : null,
    media_url: locallyOpened ? null : mediaUrl,
    media_type: mediaType,
    media_video_id: mediaVideoId,
    media_caption: mediaCaption,
    media_has_external_watermark: mediaHasExternalWatermark,
    view_once: viewOnce,
    view_once_opened_at: openedAt,
    deleted_by_sender: Boolean(row["deleted_by_sender"]),
    deleted_by_recipient: Boolean(row["deleted_by_recipient"]),
    created_at: String(row["created_at"] ?? ""),
  };
}

export function readAllowMessagesFromEveryoneLocal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ALLOW_MESSAGES_FROM_EVERYONE_KEY) === "true";
  } catch {
    return false;
  }
}

export async function fetchAllowMessagesFromEveryone(userId: string): Promise<boolean> {
  const localVal = readAllowMessagesFromEveryoneLocal();
  if (!userId) return localVal;
  try {
    const { data, error } = await untypedDb
      .from("profiles")
      .select("allow_messages_from_everyone")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return localVal;
    const raw = (data as Record<string, unknown>)["allow_messages_from_everyone"];
    if (typeof raw !== "boolean") return localVal;
    try {
      window.localStorage.setItem(ALLOW_MESSAGES_FROM_EVERYONE_KEY, String(raw));
    } catch {
      /* ignore */
    }
    return raw;
  } catch {
    return localVal;
  }
}

export async function syncAllowMessagesFromEveryone(
  userId: string | null | undefined,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ALLOW_MESSAGES_FROM_EVERYONE_KEY, String(enabled));
    }
  } catch {
    /* ignore */
  }
  if (!userId) return { ok: true };
  const { error } = await untypedDb
    .from("profiles")
    .update({ allow_messages_from_everyone: enabled })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Checks whether `myUserId` / `myHandle` is allowed to send pics or videos to `targetHandle`.
 * Rule: Followers are allowed, OR target user has "Allow messages from everyone" ON in Settings.
 */
export async function checkDmMediaPermission(params: {
  myUserId: string | null | undefined;
  myHandle: string | null | undefined;
  targetHandle: string;
}): Promise<DmMediaPermission> {
  const target = cleanHandle(params.targetHandle);
  const me = cleanHandle(params.myHandle);
  if (!target || !params.myUserId || !me) {
    return {
      allowed: false,
      isFollower: false,
      allowEveryone: false,
      recipientId: null,
      recipientHandle: target,
      reason: "Enter a valid @username to check messaging privacy.",
    };
  }

  // Request only columns visible to the signed-in sender.
  const { data: rawProfile } = await untypedDb
    .from("profiles")
    .select("id,handle,allow_messages_from_everyone")
    .ilike("handle", target)
    .maybeSingle();

  const profile = rawProfile as {
    id?: string;
    handle?: string;
    allow_messages_from_everyone?: boolean;
  } | null;

  if (!profile?.id || !profile.handle) {
    return {
      allowed: false,
      isFollower: false,
      allowEveryone: false,
      recipientId: null,
      recipientHandle: target,
      reason: `@${target} hasn't joined Coolerup yet.`,
    };
  }

  const allowEveryone =
    typeof profile.allow_messages_from_everyone === "boolean"
      ? profile.allow_messages_from_everyone
      : profile.id === params.myUserId
        ? readAllowMessagesFromEveryoneLocal()
        : false;

  if (profile.id === params.myUserId) {
    return {
      allowed: true,
      isFollower: true,
      allowEveryone,
      recipientId: profile.id,
      recipientHandle: profile.handle,
    };
  }

  if (allowEveryone) {
    return {
      allowed: true,
      isFollower: false,
      allowEveryone: true,
      recipientId: profile.id,
      recipientHandle: profile.handle,
    };
  }

  const { data: following } = await supabase
    .from("follows")
    .select("id")
    .eq("follower_id", params.myUserId)
    .eq("following_username", profile.handle)
    .limit(1)
    .maybeSingle();
  if (following) {
    return {
      allowed: true,
      isFollower: true,
      allowEveryone: false,
      recipientId: profile.id,
      recipientHandle: profile.handle,
    };
  }

  return {
    allowed: false,
    isFollower: false,
    allowEveryone: false,
    recipientId: profile.id,
    recipientHandle: profile.handle,
    reason: `Follow @${profile.handle} before messaging unless @${profile.handle} turns on "Allow messages from everyone" in Settings.`,
  };
}

export async function fetchDirectMessages(): Promise<DirectMessage[]> {
  // Always use `select("*")` so older databases without the 20261226000000 columns
  // never throw "column direct_messages.deleted_by_recipient does not exist".
  const { data, error } = await untypedDb
    .from("direct_messages")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) return [];
  const deletedLocal = getDeletedDmIdsLocal();
  const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeDmRow);
  if (data && data.length > 0) {
    extendedDmSchemaSupported = "deleted_by_recipient" in ((data[0] ?? {}) as object);
  }
  return rows.filter((r) => !deletedLocal.has(r.id));
}

export function isImageMediaFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(file.name);
}

export function isVideoMediaFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v)$/i.test(file.name);
}

export async function uploadDmMediaFile(params: {
  userId: string;
  username: string;
  file: File;
}): Promise<{
  url: string;
  mediaType: "image" | "video";
  hasExternalWatermark: boolean;
}> {
  const { file } = params;
  const isImg = isImageMediaFile(file);
  const isVid = isVideoMediaFile(file);
  if (!isImg && !isVid) {
    throw new Error("Please select a photo or video file.");
  }

  const maxBytes = isImg ? MAX_DM_IMAGE_BYTES : MAX_DM_VIDEO_BYTES;
  if (file.size > maxBytes) {
    throw new Error(
      isImg ? "Photo is too large (max 20 MB)." : "Video is too large for chat (max 100 MB).",
    );
  }

  const wmResult = isVid
    ? await detectExternalWatermark({ blob: file, filename: file.name }).catch(() => null)
    : null;
  const hasExternalWatermark = Boolean(wmResult?.detected);

  const rawExt =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "";
  const ext = rawExt || (isImg ? "jpg" : "mp4");
  const baseName =
    file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || (isImg ? "photo" : "video");
  const path = `${DM_FOLDER}/${Date.now()}_${baseName}.${ext}`;

  const contentType = file.type || (isImg ? "image/jpeg" : "video/mp4");

  console.log(`Trying bucket: ${DM_MEDIA_BUCKET}`);
  console.log(`File size: ${file.size}`);

  let bucket = DM_MEDIA_BUCKET;
  let uploadError = await uploadToBucket(bucket, path, file, contentType);

  if (uploadError && isMissingBucketError(uploadError)) {
    console.log(`Bucket "${DM_MEDIA_BUCKET}" not found — falling back to "${DM_FALLBACK_BUCKET}"`);
    console.log(`Trying bucket: ${DM_FALLBACK_BUCKET}`);
    bucket = DM_FALLBACK_BUCKET;
    uploadError = await uploadToBucket(bucket, path, file, contentType);
  }

  if (uploadError) {
    // Surface the real Supabase error instead of a generic message.
    throw new Error(
      `Upload to "${bucket}" failed: ${uploadError.message}` +
        (uploadError.name ? ` (${uploadError.name})` : ""),
    );
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  const publicUrl = publicData?.publicUrl || "";
  console.log(`Uploaded to bucket: ${bucket} → ${publicUrl}`);

  return {
    url: publicUrl,
    mediaType: isImg ? "image" : "video",
    hasExternalWatermark,
  };
}

type StorageErrorLike = { message: string; name?: string };

/** True when the error means the bucket itself is missing, not a bad file. */
function isMissingBucketError(err: StorageErrorLike): boolean {
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("bucket not found") ||
    msg.includes("bucket does not exist") ||
    (msg.includes("not found") && msg.includes("bucket"))
  );
}

async function uploadToBucket(
  bucket: string,
  path: string,
  file: File,
  contentType: string,
): Promise<StorageErrorLike | null> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType,
    upsert: false,
  });
  if (!error) return null;
  console.error(`Upload to "${bucket}" failed:`, error);
  return { message: error.message || "Unknown storage error", name: error.name };
}

export async function resolveDmMediaUrl(rawUrl: string | null | undefined): Promise<string> {
  if (!rawUrl) return "";
  // Legacy rows from the old private `dm-media` bucket still need signing.
  if (rawUrl.startsWith(DM_MEDIA_PREFIX)) {
    const path = rawUrl.slice(DM_MEDIA_PREFIX.length);
    const hit = signedDmUrlCache.get(path);
    if (hit && hit.expiresAt > Date.now()) return hit.url;
    const { data, error } = await supabase.storage.from("dm-media").createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return "";
    signedDmUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + 55 * 60 * 1000,
    });
    return data.signedUrl;
  }
  // New uploads store a public URL for `direct-messages`; return it as-is.
  if (rawUrl.includes("/object/public/direct-messages/")) return rawUrl;
  return resolveMediaUrl(rawUrl);
}

export async function sendDirectMessage(params: {
  fromId: string;
  fromUsername: string;
  toUsername: string;
  message?: string;
  gifUrl?: string | null;
  gifCredit?: string | null;
  mediaUrl?: string | null;
  mediaType?: DmMediaType | null;
  mediaVideoId?: string | null;
  mediaCaption?: string | null;
  mediaHasExternalWatermark?: boolean;
  viewOnce?: boolean | undefined;
}): Promise<{ ok: boolean; row?: DirectMessage | undefined; error?: string | undefined }> {
  const fromHandle = cleanHandle(params.fromUsername);
  const toHandle = cleanHandle(params.toUsername);
  const text = (params.message ?? "").trim();

  if (!toHandle || !fromHandle || !params.fromId) {
    return { ok: false, error: "Sign in and enter a valid recipient." };
  }
  if (!text && !params.gifUrl && !params.mediaUrl) {
    return { ok: false, error: "Add a message, GIF, photo, or video first." };
  }

  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("id, handle")
    .ilike("handle", toHandle)
    .maybeSingle();

  if (!targetProfile) {
    return { ok: false, error: `@${toHandle} hasn't joined Coolerup yet.` };
  }

  // Check the same recipient rule for every message type.
  {
    const perm = await checkDmMediaPermission({
      myUserId: params.fromId,
      myHandle: fromHandle,
      targetHandle: targetProfile.handle,
    });
    if (!perm.allowed) {
      return {
        ok: false,
        error: perm.reason || `@${targetProfile.handle} only accepts messages from followers.`,
      };
    }
  }

  // Ensure legacy RLS rule `length(message) BETWEEN 1 AND 2000` is satisfied when
  // sending GIF-only or media-only messages on databases without the updated RLS policy.
  const basePayload: Record<string, unknown> = {
    from_id: params.fromId,
    to_id: targetProfile.id,
    from_username: fromHandle,
    to_username: targetProfile.handle,
    message: text || (params.gifUrl ? "GIF" : " "),
    gif_url: params.gifUrl ?? null,
    gif_credit: params.gifCredit ?? null,
  };

  if (extendedDmSchemaSupported !== false) {
    const extendedPayload: Record<string, unknown> = {
      ...basePayload,
      message: text,
      ...(params.mediaUrl
        ? {
            media_url: params.mediaUrl,
            media_type: params.mediaType ?? "image",
            media_video_id: params.mediaVideoId ?? null,
            media_caption: params.mediaCaption ?? null,
            media_has_external_watermark: Boolean(params.mediaHasExternalWatermark),
            view_once: Boolean(params.viewOnce),
          }
        : {}),
    };

    const { data: inserted, error } = await untypedDb
      .from("direct_messages")
      .insert(extendedPayload)
      .select("*")
      .maybeSingle();

    if (!error) {
      extendedDmSchemaSupported = true;
      return {
        ok: true,
        ...(inserted ? { row: normalizeDmRow(inserted as Record<string, unknown>) } : {}),
      };
    }

    if (!isMissingColumnOrSchemaError(error)) {
      return { ok: false, error: error.message || "Couldn't send message." };
    }

    // Extended DM columns haven't been migrated yet: fall back cleanly to legacy columns.
    extendedDmSchemaSupported = false;
  }

  const legacyMessage = params.mediaUrl
    ? withLegacyDmMediaMessage(text, {
        mediaUrl: params.mediaUrl,
        mediaType: params.mediaType ?? "image",
        mediaVideoId: params.mediaVideoId,
        mediaCaption: params.mediaCaption,
        mediaHasExternalWatermark: params.mediaHasExternalWatermark,
        viewOnce: params.viewOnce,
      })
    : text || (params.gifUrl ? "GIF" : " ");

  const { data: legacyInserted, error: legacyErr } = await supabase
    .from("direct_messages")
    .insert({
      from_id: params.fromId,
      to_id: targetProfile.id,
      from_username: fromHandle,
      to_username: targetProfile.handle,
      message: legacyMessage,
      gif_url: params.gifUrl ?? null,
      gif_credit: params.gifCredit ?? null,
    })
    .select("*")
    .maybeSingle();

  if (legacyErr) {
    return { ok: false, error: legacyErr.message || "Couldn't send message." };
  }

  return {
    ok: true,
    ...(legacyInserted ? { row: normalizeDmRow(legacyInserted as Record<string, unknown>) } : {}),
  };
}

export async function openViewOnceMedia(params: { msg: DirectMessage; myHandle: string }): Promise<{
  ok: boolean;
  expired?: boolean;
  resolvedUrl?: string;
  mediaType?: DmMediaType;
  error?: string;
}> {
  const { msg, myHandle } = params;
  const me = cleanHandle(myHandle);

  if (!msg.view_once) {
    const url = await resolveDmMediaUrl(msg.media_url);
    return url
      ? { ok: true, resolvedUrl: url, mediaType: msg.media_type ?? "image" }
      : { ok: false, error: "Media unavailable." };
  }

  if (cleanHandle(msg.from_username) === me && cleanHandle(msg.to_username) !== me) {
    return { ok: false, error: "Sent View Once photo/video — only the recipient can open it." };
  }

  if (isViewOnceExpired(msg)) {
    return { ok: false, expired: true, error: "Already opened — this media has disappeared." };
  }

  const { data, error } = await untypedDb.rpc("open_view_once_dm", {
    _message_id: msg.id,
  });

  if (error && isMissingColumnOrSchemaError(error)) {
    // Fallback if SQL RPC hasn't been deployed yet.
    const rawUrl = msg.media_url;
    markViewOnceOpenedLocal(msg.id);
    if (!rawUrl) return { ok: false, expired: true, error: "Already opened." };
    const resolvedUrl = await resolveDmMediaUrl(rawUrl);
    return resolvedUrl
      ? { ok: true, resolvedUrl, mediaType: msg.media_type ?? "image" }
      : { ok: false, error: "Could not load View Once media." };
  }

  if (error) {
    return { ok: false, error: error.message || "Could not open media." };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result["ok"] !== true) {
    if (result["expired"]) markViewOnceOpenedLocal(msg.id);
    return {
      ok: false,
      expired: Boolean(result["expired"]),
      error: String(result["error"] ?? "Could not open media."),
    };
  }

  markViewOnceOpenedLocal(msg.id);
  const rawUrl = typeof result["media_url"] === "string" ? result["media_url"] : "";
  const resolvedUrl = await resolveDmMediaUrl(rawUrl);
  if (!resolvedUrl) {
    return { ok: false, error: "Media expired or could not be loaded." };
  }

  const rawType = result["media_type"];
  const mediaType: DmMediaType =
    rawType === "video" || rawType === "coolerup_video" ? rawType : "image";

  return { ok: true, resolvedUrl, mediaType };
}

export async function deleteDirectMessage(
  messageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await untypedDb.rpc("delete_dm_message", {
    _message_id: messageId,
  });

  if (error && isMissingColumnOrSchemaError(error)) {
    // Best-effort delete on DB; also hide locally so both sender and recipient see deletion immediately.
    await supabase.from("direct_messages").delete().eq("id", messageId);
    markDmDeletedLocal(messageId);
    return { ok: true };
  }

  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as Record<string, unknown>;
  if (row["ok"] === false) {
    return { ok: false, error: String(row["error"] ?? "Couldn't delete message") };
  }
  markDmDeletedLocal(messageId);
  return { ok: true };
}

/**
 * Saves a DM photo or video to device. Video exports always go through
 * `prepareWatermarkedFile` so Smart Watermark preserves pre-marked uploads and
 * burns the moving Coolerup mark onto native videos.
 */
export async function saveDmMediaToDevice(params: {
  msg: DirectMessage;
  resolvedUrl?: string | undefined;
  onProgress?: ((progress: WatermarkProgress) => void) | undefined;
}): Promise<{ shared?: boolean }> {
  const { msg, resolvedUrl, onProgress } = params;
  const src = resolvedUrl || (await resolveDmMediaUrl(msg.media_url ?? msg.gif_url));
  if (!src) throw new Error("Media unavailable.");

  const resp = await fetch(src);
  if (!resp.ok) throw new Error("Could not download media.");
  const blob = await resp.blob();
  const ext = downloadExtension(src, blob);
  const filename = `coolerup-dm-${msg.id}.${ext}`;

  const isVideo = msg.media_type === "video" || msg.media_type === "coolerup_video";
  let outFile: File;

  if (isVideo) {
    outFile = await prepareWatermarkedFile({
      blob,
      username: msg.from_username,
      filename,
      ...(onProgress ? { onProgress } : {}),
    });
  } else {
    outFile = new File([blob], filename, {
      type: blob.type || "image/jpeg",
      lastModified: Date.now(),
    });
  }

  const isTouch =
    typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isTouch && navigator.canShare?.({ files: [outFile] })) {
    await navigator.share({ files: [outFile] });
    return { shared: true };
  }

  saveFileToDisk(outFile);
  return { shared: false };
}

/** Paginated 10-at-a-time query of native Coolerup videos to attach in Messages. */
export async function fetchCoolerupVideosForDm(params: {
  limit?: number;
  offset?: number;
  query?: string;
}): Promise<{ items: CoolerupVideoChoice[]; hasMore: boolean }> {
  const limit = params.limit ?? 10;
  const offset = params.offset ?? 0;
  const q = (params.query ?? "").trim();

  let req = untypedDb
    .from("videos")
    .select("*")
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (q) {
    const safe = q.replace(/[%_,()]/g, "").trim();
    if (safe) {
      req = req.or(`caption.ilike.%${safe}%,username.ilike.%${safe}%`);
    }
  }

  const { data, error } = await req;
  if (error) return { items: [], hasMore: false };

  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r["id"] ?? ""),
    username: String(r["username"] ?? "user"),
    caption: String(r["caption"] ?? ""),
    video_url: String(r["video_url"] ?? ""),
    has_external_watermark: Boolean(r["has_external_watermark"]),
    likes_count: Number(r["likes_count"] ?? 0),
  }));

  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}
