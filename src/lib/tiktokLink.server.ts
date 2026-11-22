/**
 * Coolerup · TikTok Login Kit + Content Posting API (server only).
 *
 * Everything here talks to TikTok's published endpoints. Nothing scrapes, and
 * nothing ever acts on an account the caller did not personally authorise:
 *
 *   - `buildAuthorizeUrl` sends the user to TikTok's own login screen, so the
 *     password is typed into TikTok, never into Coolerup.
 *   - `listMyVideos` calls `/v2/video/list/` with that user's own token, which
 *     returns only their own videos by construction.
 *   - `publishVideo` uses `/v2/post/publish/video/init/`, which posts to the
 *     account that owns the token.
 *
 * Tokens live in `public.tiktok_accounts`, which has no client select policy.
 * They are never returned to the browser and never logged.
 */
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_API = "https://open.tiktokapis.com/v2";

/**
 * `user.info.basic` gives the handle and follower count.
 * `video.list` lets the user pick their own videos to import.
 * `video.publish` / `video.upload` allow posting back to their account.
 */
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "user.info.stats",
  "video.list",
  "video.publish",
  "video.upload",
].join(",");

export const TIKTOK_POSTED_FROM = "Posted from Coolerup";

export type TikTokCredentials = { clientKey: string; clientSecret: string };

export function getTikTokCredentials(): TikTokCredentials {
  return {
    clientKey: (process.env["TIKTOK_CLIENT_KEY"] ?? "").trim(),
    clientSecret: (process.env["TIKTOK_CLIENT_SECRET"] ?? "").trim(),
  };
}

export function isTikTokConfigured(): boolean {
  const { clientKey, clientSecret } = getTikTokCredentials();
  return Boolean(clientKey && clientSecret);
}

export function getTikTokRedirectUri(request: Request): string {
  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/+$/, "");
  if (appUrl) return `${appUrl}/api/tiktok/auth/callback`;
  return `${new URL(request.url).origin}/api/tiktok/auth/callback`;
}

// ---------------------------------------------------------------------------
// Sealed OAuth state
// ---------------------------------------------------------------------------
// The state has to survive a full round trip through TikTok and come back
// carrying the Coolerup user id, so it is encrypted rather than merely signed —
// a signed-but-readable state would leak user ids to anyone who saw the URL.

function stateKey(): Buffer {
  const { clientSecret } = getTikTokCredentials();
  // Falls back to the service key so a half-configured deploy still produces a
  // stable key rather than throwing on every request.
  const material = clientSecret || (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  return createHash("sha256").update(`coolerup-tiktok-state:${material}`).digest();
}

export type TikTokStatePayload = {
  userId: string;
  /** Where to send the popup back to, so Settings can refresh in place. */
  returnTo?: string;
  exp: number;
};

export function sealState(payload: TikTokStatePayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64url");
}

export function openState(state: string | null): TikTokStatePayload | null {
  if (!state) return null;
  try {
    const raw = Buffer.from(state, "base64url");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", stateKey(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    const payload = JSON.parse(json) as TikTokStatePayload;
    if (!payload?.userId || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(request: Request, userId: string): string | null {
  const { clientKey } = getTikTokCredentials();
  if (!clientKey) return null;
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: TIKTOK_SCOPES,
    response_type: "code",
    redirect_uri: getTikTokRedirectUri(request),
    state: sealState({ userId, exp: Date.now() + 10 * 60 * 1000 }),
    // Always show the account picker: "their own account" is the whole point,
    // so silently reusing a previously authorised one would be wrong.
    disable_auto_auth: "1",
  });
  return `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export type TikTokTokenSet = {
  open_id: string;
  scope: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  token_type: string;
};

export async function exchangeCode(code: string, redirectUri: string): Promise<TikTokTokenSet | null> {
  const { clientKey, clientSecret } = getTikTokCredentials();
  if (!clientKey || !clientSecret) return null;
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Partial<TikTokTokenSet> & { error?: string };
  if (json.error || !json.access_token || !json.open_id) return null;
  return json as TikTokTokenSet;
}

async function refreshTokenSet(refreshToken: string): Promise<TikTokTokenSet | null> {
  const { clientKey, clientSecret } = getTikTokCredentials();
  if (!clientKey || !clientSecret) return null;
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cache-control": "no-cache" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Partial<TikTokTokenSet> & { error?: string };
  if (json.error || !json.access_token) return null;
  return json as TikTokTokenSet;
}

// ---------------------------------------------------------------------------
// Stored account access
// ---------------------------------------------------------------------------

export type LinkedAccount = {
  user_id: string;
  open_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number;
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
};

/** Reads the caller's own linked row. Service role, so RLS does not apply. */
export async function getLinkedAccount(userId: string): Promise<LinkedAccount | null> {
  const { data, error } = await supabaseAdmin
    .from("tiktok_accounts")
    .select(
      "user_id, open_id, username, display_name, avatar_url, follower_count, access_token, refresh_token, access_expires_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as LinkedAccount;
}

/**
 * Returns a usable access token, refreshing when it is within two minutes of
 * expiry. Returns null when the account is gone or the refresh was rejected
 * (which means the user revoked access on TikTok's side).
 */
export async function freshAccessToken(userId: string): Promise<{ token: string; account: LinkedAccount } | null> {
  const account = await getLinkedAccount(userId);
  if (!account) return null;

  const expiresAt = new Date(account.access_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 2 * 60 * 1000) {
    return { token: account.access_token, account };
  }

  const refreshed = await refreshTokenSet(account.refresh_token);
  if (!refreshed) return null;

  const now = Date.now();
  await supabaseAdmin
    .from("tiktok_accounts")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? account.refresh_token,
      access_expires_at: new Date(now + (refreshed.expires_in ?? 86400) * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    })
    .eq("user_id", userId);

  return {
    token: refreshed.access_token,
    account: { ...account, access_token: refreshed.access_token },
  };
}

// ---------------------------------------------------------------------------
// user.info.basic / user.info.stats
// ---------------------------------------------------------------------------

export type TikTokUserInfo = {
  open_id: string;
  union_id?: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
};

export async function fetchUserInfo(accessToken: string): Promise<TikTokUserInfo | null> {
  const fields = [
    "open_id",
    "union_id",
    "username",
    "display_name",
    "avatar_url",
    "follower_count",
    "following_count",
    "likes_count",
    "video_count",
  ].join(",");
  const res = await fetch(`${TIKTOK_API}/user/info/?fields=${encodeURIComponent(fields)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { user?: TikTokUserInfo }; error?: { code?: string } };
  if (json.error?.code && json.error.code !== "ok") return null;
  return json.data?.user ?? null;
}

/** Persists a freshly authorised account, replacing any previous link. */
export async function saveLinkedAccount(
  userId: string,
  tokens: TikTokTokenSet,
  info: TikTokUserInfo,
): Promise<void> {
  const now = Date.now();
  await supabaseAdmin.from("tiktok_accounts").upsert(
    {
      user_id: userId,
      open_id: tokens.open_id,
      union_id: info.union_id ?? null,
      username: info.username,
      display_name: info.display_name ?? null,
      avatar_url: info.avatar_url ?? null,
      follower_count: info.follower_count ?? 0,
      following_count: info.following_count ?? 0,
      likes_count: info.likes_count ?? 0,
      video_count: info.video_count ?? 0,
      scope: tokens.scope ?? TIKTOK_SCOPES,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_expires_at: new Date(now + (tokens.expires_in ?? 86400) * 1000).toISOString(),
      refresh_expires_at:
        tokens.refresh_expires_in != null
          ? new Date(now + tokens.refresh_expires_in * 1000).toISOString()
          : null,
      last_synced_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    },
    { onConflict: "user_id" },
  );
}

export async function unlinkAccount(userId: string): Promise<void> {
  await supabaseAdmin.from("tiktok_accounts").delete().eq("user_id", userId);
}

// ---------------------------------------------------------------------------
// video.list — the caller's OWN videos
// ---------------------------------------------------------------------------

export type TikTokOwnVideo = {
  id: string;
  title?: string;
  video_description?: string;
  cover_image_url?: string;
  share_url?: string;
  duration?: number;
  create_time?: number;
};

/**
 * Lists videos belonging to the token holder. TikTok scopes this endpoint to the
 * authorised account, so there is no way to ask it for somebody else's videos.
 */
export async function listMyVideos(accessToken: string, cursor?: number, limit = 20) {
  const fields = "id,title,video_description,cover_image_url,share_url,duration,create_time";
  const res = await fetch(
    `${TIKTOK_API}/video/list/?fields=${encodeURIComponent(fields)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ max_count: Math.min(20, Math.max(1, limit)), cursor: cursor ?? 0 }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TikTok video list failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as {
    data?: { videos?: TikTokOwnVideo[]; cursor?: number; has_more?: boolean };
    error?: { code?: string; message?: string };
  };
  if (json.error?.code && json.error.code !== "ok") {
    throw new Error(json.error.message || `TikTok video list error: ${json.error.code}`);
  }
  return {
    videos: json.data?.videos ?? [],
    cursor: json.data?.cursor ?? 0,
    hasMore: Boolean(json.data?.has_more),
  };
}

// ---------------------------------------------------------------------------
// Content Posting API
// ---------------------------------------------------------------------------

export type PublishResult = {
  ok: boolean;
  publishId?: string | undefined;
  mode: "direct" | "inbox";
  error?: string;
};

/** Builds the caption TikTok receives: the original text, the watermark line, and the tag. */
export function tiktokCaption(caption: string): string {
  const base = (caption ?? "").trim();
  if (!base) return TIKTOK_POSTED_FROM;
  // TikTok rejects titles over 2200 characters; keep well inside it. Trim the
  // user's text — never the tag — so "Posted from Coolerup" always survives.
  const room = 2100 - TIKTOK_POSTED_FROM.length - 2;
  const trimmed = base.length > room ? base.slice(0, room).trimEnd() : base;
  return `${trimmed}\n\n${TIKTOK_POSTED_FROM}`;
}

/**
 * Posts a video to the authorised account.
 *
 * Direct post (`/post/publish/video/init/`) is the real "auto-post" path, but
 * TikTok only enables it for apps that have passed their content-posting audit.
 * An unaudited app gets `unaudited_client_can_only_post_to_private_accounts`.
 * Rather than fail the user's upload, we fall back to the inbox endpoint, which
 * delivers the video into their TikTok drafts to finish posting by hand.
 */
export async function publishVideo(input: {
  accessToken: string;
  videoUrl: string;
  caption: string;
  privacyLevel?: string | undefined;
}): Promise<PublishResult> {
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(input.videoUrl);
    if (!res.ok) {
      return { ok: false, mode: "direct", error: `Could not read the video file (${res.status}).` };
    }
    bytes = await res.arrayBuffer();
  } catch {
    return { ok: false, mode: "direct", error: "Could not download the video to send to TikTok." };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, mode: "direct", error: "The video file is empty." };
  }

  const direct = await initDirectPost(input.accessToken, bytes.byteLength, input.caption, input.privacyLevel);
  if (direct.ok && direct.uploadUrl) {
    const uploaded = await putBytes(direct.uploadUrl, bytes);
    if (uploaded) return { ok: true, mode: "direct", publishId: direct.publishId };
    return {
      ok: false,
      mode: "direct",
      error: "TikTok accepted the post but the video upload failed.",
    };
  }

  const inbox = await initInboxUpload(input.accessToken, bytes.byteLength);
  if (inbox.ok && inbox.uploadUrl) {
    const uploaded = await putBytes(inbox.uploadUrl, bytes);
    if (uploaded) return { ok: true, mode: "inbox", publishId: inbox.publishId };
    return { ok: false, mode: "inbox", error: "TikTok accepted the upload slot but the file transfer failed." };
  }

  return { ok: false, mode: "direct", error: direct.error ?? inbox.error ?? "TikTok rejected the post." };
}

async function initDirectPost(
  accessToken: string,
  size: number,
  caption: string,
  privacyLevel?: string | undefined,
): Promise<{ ok: boolean; uploadUrl?: string | undefined; publishId?: string | undefined; error?: string | undefined }> {
  const chunkSize = size;
  const res = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      post_info: {
        title: tiktokCaption(caption),
        privacy_level: privacyLevel ?? "SELF_ONLY",
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: 1,
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };
  const code = json.error?.code;
  if (!res.ok || (code && code !== "ok") || !json.data?.upload_url) {
    return {
      ok: false,
      error: json.error?.message || `TikTok direct post unavailable (${code ?? res.status}).`,
    };
  }
  return { ok: true, uploadUrl: json.data.upload_url, publishId: json.data.publish_id };
}

async function initInboxUpload(
  accessToken: string,
  size: number,
): Promise<{ ok: boolean; uploadUrl?: string | undefined; publishId?: string | undefined; error?: string | undefined }> {
  const res = await fetch(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };
  if (!res.ok || !json.data?.upload_url) {
    return { ok: false, error: json.error?.message || `TikTok inbox upload unavailable (${res.status}).` };
  }
  return { ok: true, uploadUrl: json.data.upload_url, publishId: json.data.publish_id };
}

async function putBytes(uploadUrl: string, bytes: ArrayBuffer): Promise<boolean> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": "video/mp4",
      "content-length": String(bytes.byteLength),
      "content-range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
    },
    body: bytes,
  });
  return res.ok;
}
