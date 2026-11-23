import { supabase } from "@/integrations/supabase/client";
import { reportExplicitMedia, screenBeforeWrite } from "@/lib/autoBans";
import { resolveMediaUrl } from "@/lib/media";
import { inspectMedia } from "@/lib/nsfw";
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
  isMutual: boolean;
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

export const DM_MEDIA_BUCKET = "dm-media";
const DM_MEDIA_PREFIX = "dm-media:";
const ALLOW_MESSAGES_FROM_EVERYONE_KEY = "allowMessagesFromEveryone";
const OPENED_ONCE_LOCAL_KEY = "coolerup:dm-opened-once:v1";

const MAX_DM_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MiB
const MAX_DM_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MiB

const DM_SELECT_EXTENDED =
  "id, from_id, to_id, from_username, to_username, message, gif_url, gif_credit, media_url, media_type, media_video_id, media_caption, media_has_external_watermark, view_once, view_once_opened_at, deleted_by_sender, deleted_by_recipient, created_at";
const DM_SELECT_LEGACY =
  "id, from_id, to_id, from_username, to_username, message, gif_url, gif_credit, created_at";

const signedDmUrlCache = new Map<string, { url: string; expiresAt: number }>();

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

export function isViewOnceExpired(
  msg: Pick<DirectMessage, "id" | "view_once" | "view_once_opened_at" | "media_url">,
): boolean {
  if (!msg.view_once) return false;
  if (msg.view_once_opened_at) return true;
  if (!msg.media_url) return true;
  return getOpenedViewOnceIdsLocal().has(msg.id);
}

function normalizeDmRow(row: Record<string, unknown>): DirectMessage {
  const rawType = row["media_type"];
  const mediaType: DmMediaType | null =
    rawType === "image" || rawType === "video" || rawType === "coolerup_video" ? rawType : null;
  const viewOnce = Boolean(row["view_once"]);
  const id = String(row["id"] ?? "");
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
    message: String(row["message"] ?? ""),
    gif_url: typeof row["gif_url"] === "string" ? row["gif_url"] : null,
    gif_credit: typeof row["gif_credit"] === "string" ? row["gif_credit"] : null,
    media_url: locallyOpened
      ? null
      : typeof row["media_url"] === "string"
        ? row["media_url"]
        : null,
    media_type: mediaType,
    media_video_id: typeof row["media_video_id"] === "string" ? row["media_video_id"] : null,
    media_caption: typeof row["media_caption"] === "string" ? row["media_caption"] : null,
    media_has_external_watermark: Boolean(row["media_has_external_watermark"]),
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
    const val = Boolean(
      (data as { allow_messages_from_everyone?: unknown }).allow_messages_from_everyone,
    );
    try {
      window.localStorage.setItem(ALLOW_MESSAGES_FROM_EVERYONE_KEY, String(val));
    } catch {
      /* ignore */
    }
    return val;
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
  if (error && !isMissingColumnOrSchemaError(error)) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Checks whether `myUserId` / `myHandle` is allowed to send pics or videos to `targetHandle`.
 * Rule: Mutual followers are allowed, OR target user has "Allow messages from everyone" ON in Settings.
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
      isMutual: false,
      allowEveryone: false,
      recipientId: null,
      recipientHandle: target,
      reason: "Enter a valid @username to check messaging privacy.",
    };
  }

  let profile: { id: string; handle: string; allow_messages_from_everyone?: boolean } | null = null;
  const { data: extProfile, error: extErr } = await untypedDb
    .from("profiles")
    .select("id, handle, allow_messages_from_everyone")
    .ilike("handle", target)
    .maybeSingle();

  if (extErr && isMissingColumnOrSchemaError(extErr)) {
    const { data: baseProfile } = await supabase
      .from("profiles")
      .select("id, handle")
      .ilike("handle", target)
      .maybeSingle();
    if (baseProfile) {
      profile = {
        id: baseProfile.id,
        handle: baseProfile.handle,
        allow_messages_from_everyone:
          baseProfile.id === params.myUserId ? readAllowMessagesFromEveryoneLocal() : false,
      };
    }
  } else if (extProfile) {
    profile = extProfile as { id: string; handle: string; allow_messages_from_everyone?: boolean };
  }

  if (!profile) {
    return {
      allowed: false,
      isMutual: false,
      allowEveryone: false,
      recipientId: null,
      recipientHandle: target,
      reason: `@${target} hasn't joined Coolerup yet.`,
    };
  }

  if (profile.id === params.myUserId) {
    return {
      allowed: true,
      isMutual: true,
      allowEveryone: Boolean(profile.allow_messages_from_everyone),
      recipientId: profile.id,
      recipientHandle: profile.handle,
    };
  }

  const allowEveryone = Boolean(profile.allow_messages_from_everyone);
  if (allowEveryone) {
    return {
      allowed: true,
      isMutual: false,
      allowEveryone: true,
      recipientId: profile.id,
      recipientHandle: profile.handle,
    };
  }

  const [{ data: iFollowRow }, { data: theyFollowRow }] = await Promise.all([
    supabase
      .from("follows")
      .select("id")
      .eq("follower_id", params.myUserId)
      .ilike("following_username", profile.handle)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("follows")
      .select("id")
      .eq("follower_id", profile.id)
      .ilike("following_username", me)
      .limit(1)
      .maybeSingle(),
  ]);

  const isMutual = Boolean(iFollowRow && theyFollowRow);
  if (isMutual) {
    return {
      allowed: true,
      isMutual: true,
      allowEveryone: false,
      recipientId: profile.id,
      recipientHandle: profile.handle,
    };
  }

  return {
    allowed: false,
    isMutual: false,
    allowEveryone: false,
    recipientId: profile.id,
    recipientHandle: profile.handle,
    reason: `Pics & videos are only allowed between people who follow each other unless @${profile.handle} turns on "Allow messages from everyone" in Settings.`,
  };
}

export async function fetchDirectMessages(): Promise<DirectMessage[]> {
  const { data, error } = await untypedDb
    .from("direct_messages")
    .select(DM_SELECT_EXTENDED)
    .order("created_at", { ascending: true });

  if (error && isMissingColumnOrSchemaError(error)) {
    const { data: legacy } = await supabase
      .from("direct_messages")
      .select(DM_SELECT_LEGACY)
      .order("created_at", { ascending: true });
    return ((legacy ?? []) as Record<string, unknown>[]).map(normalizeDmRow);
  }
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeDmRow);
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
  const { userId, username, file } = params;
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

  // On-device NSFW check consistent with feed uploads.
  try {
    const verdict = await inspectMedia(file);
    if (verdict?.explicit) {
      await reportExplicitMedia({
        userId,
        username,
        source: isVid ? "video" : "photo",
        score: verdict.score,
      }).catch(() => {});
      throw new Error("Blocked: explicit photos or videos are not allowed.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Blocked:")) throw err;
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
  const uniqueId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${userId}/${uniqueId}.${ext}`;

  const { error: dmBucketErr } = await supabase.storage.from(DM_MEDIA_BUCKET).upload(path, file, {
    contentType: file.type || (isImg ? "image/jpeg" : "video/mp4"),
    upsert: false,
  });

  if (!dmBucketErr) {
    return {
      url: `${DM_MEDIA_PREFIX}${path}`,
      mediaType: isImg ? "image" : "video",
      hasExternalWatermark,
    };
  }

  // Clean fallback to `videos` bucket if `dm-media` hasn't been provisioned yet.
  const fallbackPath = `dm/${path}`;
  const { error: videosErr } = await supabase.storage.from("videos").upload(fallbackPath, file, {
    contentType: file.type || (isImg ? "image/jpeg" : "video/mp4"),
    upsert: false,
  });

  if (videosErr) {
    throw new Error(dmBucketErr.message || videosErr.message || "Could not upload media.");
  }

  return {
    url: `storage:${fallbackPath}`,
    mediaType: isImg ? "image" : "video",
    hasExternalWatermark,
  };
}

export async function resolveDmMediaUrl(rawUrl: string | null | undefined): Promise<string> {
  if (!rawUrl) return "";
  if (rawUrl.startsWith(DM_MEDIA_PREFIX)) {
    const path = rawUrl.slice(DM_MEDIA_PREFIX.length);
    const hit = signedDmUrlCache.get(path);
    if (hit && hit.expiresAt > Date.now()) return hit.url;
    const { data, error } = await supabase.storage
      .from(DM_MEDIA_BUCKET)
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return "";
    signedDmUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + 55 * 60 * 1000,
    });
    return data.signedUrl;
  }
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

  // Block pics/videos between strangers unless recipient allows everyone in Settings.
  if (params.mediaUrl) {
    const perm = await checkDmMediaPermission({
      myUserId: params.fromId,
      myHandle: fromHandle,
      targetHandle: targetProfile.handle,
    });
    if (!perm.allowed) {
      return {
        ok: false,
        error:
          perm.reason ||
          `@${targetProfile.handle} only accepts pics and videos from mutual followers.`,
      };
    }
  }

  if (text) {
    const blocked = await screenBeforeWrite({
      userId: params.fromId,
      username: fromHandle,
      text,
    });
    if (blocked) {
      return { ok: false, error: "Message blocked by safety filter." };
    }
  }

  const payload: Record<string, unknown> = {
    from_id: params.fromId,
    to_id: targetProfile.id,
    from_username: fromHandle,
    to_username: targetProfile.handle,
    message: text,
    gif_url: params.gifUrl ?? null,
    gif_credit: params.gifCredit ?? null,
  };

  if (params.mediaUrl) {
    payload["media_url"] = params.mediaUrl;
    payload["media_type"] = params.mediaType ?? "image";
    payload["media_video_id"] = params.mediaVideoId ?? null;
    payload["media_caption"] = params.mediaCaption ?? null;
    payload["media_has_external_watermark"] = Boolean(params.mediaHasExternalWatermark);
    payload["view_once"] = Boolean(params.viewOnce);
  }

  const { data: inserted, error } = await untypedDb
    .from("direct_messages")
    .insert(payload)
    .select(DM_SELECT_EXTENDED)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message || "Couldn't send message." };
  }

  return {
    ok: true,
    ...(inserted ? { row: normalizeDmRow(inserted as Record<string, unknown>) } : {}),
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
    const { error: delErr } = await supabase.from("direct_messages").delete().eq("id", messageId);
    if (delErr) return { ok: false, error: delErr.message };
    return { ok: true };
  }

  if (error) return { ok: false, error: error.message };
  const row = (data ?? {}) as Record<string, unknown>;
  if (row["ok"] === false) {
    return { ok: false, error: String(row["error"] ?? "Couldn't delete message") };
  }
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
    .select("id, username, caption, video_url, has_external_watermark, likes_count")
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
