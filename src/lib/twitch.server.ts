import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { TwitchGame, TwitchStream, TwitchStreamsResponse, TwitchUser } from "@/lib/twitch";

const TWITCH_HELIX_BASE = "https://api.twitch.tv/helix";
const TWITCH_OAUTH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_OAUTH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const SESSION_COOKIE_NAME = "coolerup_twitch_session";
const OAUTH_SCOPES = "user:read:email user:read:follows chat:read chat:edit";

export type TwitchSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: TwitchUser;
};

type CachedAppToken = {
  token: string;
  expiresAt: number;
};

let appTokenCache: CachedAppToken | null = null;
const pendingStates = new Map<string, number>();
const memorySessions = new Map<string, TwitchSession>();

function getTwitchCredentials(): { clientId: string; clientSecret: string } {
  const clientId = (process.env["TWITCH_CLIENT_ID"] ?? "").trim();
  const clientSecret = (process.env["TWITCH_CLIENT_SECRET"] ?? "").trim();
  return { clientId, clientSecret };
}

export function getTwitchRedirectUri(request: Request): string {
  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/+$/, "");
  if (appUrl) {
    return `${appUrl}/api/twitch/auth/callback`;
  }
  const url = new URL(request.url);
  return `${url.origin}/api/twitch/auth/callback`;
}

export function createOAuthState(): string {
  const now = Date.now();
  for (const [key, exp] of pendingStates.entries()) {
    if (exp < now) pendingStates.delete(key);
  }
  const state = randomBytes(18).toString("hex");
  pendingStates.set(state, now + 10 * 60 * 1000);
  return state;
}

export function consumeOAuthState(state: string | null): boolean {
  if (!state) return false;
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return typeof exp === "number" && exp >= Date.now();
}

function getEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function sealSession(session: TwitchSession, secret: string): string {
  const key = getEncryptionKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(session);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function unsealSession(token: string, secret: string): TwitchSession | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const key = getEncryptionKey(secret);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as TwitchSession;
    if (!parsed?.accessToken || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function createTwitchSessionCookie(session: TwitchSession): string {
  const { clientSecret } = getTwitchCredentials();
  let value: string;
  if (clientSecret) {
    value = `v1.${sealSession(session, clientSecret)}`;
  } else {
    const sid = randomBytes(24).toString("hex");
    memorySessions.set(sid, session);
    value = `mem.${sid}`;
  }
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000`;
}

export function clearTwitchSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

export function getTwitchSession(request: Request): TwitchSession | null {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;

  if (raw.startsWith("v1.")) {
    const { clientSecret } = getTwitchCredentials();
    if (!clientSecret) return null;
    return unsealSession(raw.slice(3), clientSecret);
  }

  if (raw.startsWith("mem.")) {
    return memorySessions.get(raw.slice(4)) ?? null;
  }

  return null;
}

export function buildTwitchAuthorizeUrl(request: Request): {
  url: string;
  redirectUri: string;
} | null {
  const { clientId } = getTwitchCredentials();
  if (!clientId) return null;
  const redirectUri = getTwitchRedirectUri(request);
  const state = createOAuthState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES,
    state,
    force_verify: "true",
  });
  return {
    url: `${TWITCH_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
    redirectUri,
  };
}

export async function exchangeTwitchCode(
  code: string,
  redirectUri: string,
): Promise<TwitchSession | null> {
  const { clientId, clientSecret } = getTwitchCredentials();
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch(TWITCH_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (!tokenRes.ok) return null;

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokenJson.access_token) return null;

  const userRes = await fetch(`${TWITCH_HELIX_BASE}/users`, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${tokenJson.access_token}`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!userRes.ok) return null;

  const userJson = (await userRes.json()) as { data?: TwitchUser[] };
  const user = userJson.data?.[0];
  if (!user) return null;

  return {
    accessToken: tokenJson.access_token,
    ...(tokenJson.refresh_token ? { refreshToken: tokenJson.refresh_token } : {}),
    expiresAt: Date.now() + (tokenJson.expires_in ?? 3600) * 1000,
    user,
  };
}

async function getAppAccessToken(): Promise<string | null> {
  const { clientId, clientSecret } = getTwitchCredentials();
  if (!clientId || !clientSecret) return null;
  if (appTokenCache && Date.now() < appTokenCache.expiresAt - 60_000) {
    return appTokenCache.token;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch(TWITCH_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;

  appTokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return appTokenCache.token;
}

async function helixGet<T>(path: string, clientId: string, bearerToken: string): Promise<T | null> {
  const res = await fetch(`${TWITCH_HELIX_BASE}${path}`, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${bearerToken}`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function enrichStreamsWithAvatars(
  streams: TwitchStream[],
  clientId: string,
  bearerToken: string,
): Promise<TwitchStream[]> {
  if (streams.length === 0) return [];
  const ids = Array.from(new Set(streams.map((s) => s.user_id).filter(Boolean))).slice(0, 25);
  if (ids.length === 0) return streams;

  const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
  const usersRes = await helixGet<{ data?: TwitchUser[] }>(`/users?${qs}`, clientId, bearerToken);
  const avatarMap = new Map<string, string>();
  for (const u of usersRes?.data ?? []) {
    if (u.id && u.profile_image_url) avatarMap.set(u.id, u.profile_image_url);
  }
  return streams.map((s) => ({
    ...s,
    avatar_url: avatarMap.get(s.user_id) ?? null,
  }));
}

export async function fetchTwitchDirectory(
  request: Request,
  options: { gameId?: string | undefined; query?: string | undefined },
): Promise<TwitchStreamsResponse> {
  const { clientId } = getTwitchCredentials();
  const session = getTwitchSession(request);
  const bearerToken = session?.accessToken ?? (await getAppAccessToken());

  if (!clientId || !bearerToken) {
    return {
      configured: false,
      streams: [],
      games: [],
    };
  }

  const q = (options.query ?? "").trim();
  const gameId = (options.gameId ?? "").trim();

  try {
    if (q) {
      const [channelsRes, categoriesRes] = await Promise.all([
        helixGet<{
          data?: Array<{
            id: string;
            broadcaster_login: string;
            display_name: string;
            game_id: string;
            game_name: string;
            is_live: boolean;
            thumbnail_url: string;
            title: string;
          }>;
        }>(
          `/search/channels?query=${encodeURIComponent(q)}&live_only=true&first=20`,
          clientId,
          bearerToken,
        ),
        helixGet<{ data?: TwitchGame[] }>(
          `/search/categories?query=${encodeURIComponent(q)}&first=12`,
          clientId,
          bearerToken,
        ),
      ]);

      const channels = channelsRes?.data ?? [];
      let streams: TwitchStream[] = [];
      if (channels.length > 0) {
        const userQuery = channels
          .slice(0, 20)
          .map((c) => `user_id=${encodeURIComponent(c.id)}`)
          .join("&");
        const liveRes = await helixGet<{ data?: TwitchStream[] }>(
          `/streams?${userQuery}&first=20`,
          clientId,
          bearerToken,
        );
        const liveById = new Map<string, TwitchStream>();
        for (const s of liveRes?.data ?? []) {
          liveById.set(s.user_id, s);
        }
        streams = channels.map((c) => {
          const live = liveById.get(c.id);
          if (live) {
            return { ...live, avatar_url: c.thumbnail_url || null };
          }
          return {
            id: c.id,
            user_id: c.id,
            user_login: c.broadcaster_login,
            user_name: c.display_name,
            game_id: c.game_id,
            game_name: c.game_name || "Live",
            title: c.title || `${c.display_name} is live`,
            viewer_count: 0,
            thumbnail_url: c.thumbnail_url,
            avatar_url: c.thumbnail_url || null,
          };
        });
      }

      return {
        configured: true,
        streams,
        games: categoriesRes?.data ?? [],
      };
    }

    const streamQuery = gameId
      ? `/streams?game_id=${encodeURIComponent(gameId)}&first=20`
      : "/streams?first=20";

    const [streamsRes, gamesRes] = await Promise.all([
      helixGet<{ data?: TwitchStream[] }>(streamQuery, clientId, bearerToken),
      helixGet<{ data?: TwitchGame[] }>("/games/top?first=15", clientId, bearerToken),
    ]);

    const streams = await enrichStreamsWithAvatars(streamsRes?.data ?? [], clientId, bearerToken);

    return {
      configured: true,
      streams,
      games: gamesRes?.data ?? [],
    };
  } catch (err) {
    return {
      configured: true,
      streams: [],
      games: [],
      error: err instanceof Error ? err.message : "Failed to load Twitch streams",
    };
  }
}

export async function checkUserFollowsBroadcaster(
  session: TwitchSession,
  broadcasterId: string,
): Promise<boolean> {
  const { clientId } = getTwitchCredentials();
  if (!clientId || !broadcasterId) return false;
  const res = await helixGet<{ data?: Array<{ broadcaster_id: string }> }>(
    `/channels/followed?user_id=${encodeURIComponent(session.user.id)}&broadcaster_id=${encodeURIComponent(broadcasterId)}`,
    clientId,
    session.accessToken,
  );
  return (res?.data?.length ?? 0) > 0;
}
