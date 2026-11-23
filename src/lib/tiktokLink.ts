/**
 * Coolerup · Linked TikTok account (browser side).
 *
 * Talks only to the `/api/tiktok/*` routes, which hold the client secret and the
 * stored tokens. Nothing in this file ever sees an access token.
 *
 * The whole feature is scoped to the user's own account: `listMyTikTokVideos`
 * returns what TikTok returns for their token, and there is no handle parameter
 * anywhere, so importing somebody else's videos is not expressible.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { tiktokCanonicalUrl, tiktokCreatorUrl } from "@/lib/tiktok";
import { withTikTokSchema } from "@/lib/tiktokDatabase";

const tiktokDatabase = withTikTokSchema(supabase);

export type LinkedTikTok = {
  openId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
  connectedAt: string;
  lastSyncedAt: string | null;
};

export type TikTokLinkState = {
  account: LinkedTikTok | null;
  loading: boolean;
  /** True once the RPC answered, so the UI can tell "not linked" from "not checked". */
  checked: boolean;
  refresh: () => Promise<void>;
};

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/** Reads the caller's linked account through the token-free RPC. */
export async function fetchLinkedTikTok(): Promise<LinkedTikTok | null> {
  const { data, error } = await tiktokDatabase.rpc("my_tiktok_account");
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    openId: row.open_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    followerCount: Number(row.follower_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    likesCount: Number(row.likes_count ?? 0),
    videoCount: Number(row.video_count ?? 0),
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
  };
}

export function useTikTokAccount(enabled = true): TikTokLinkState {
  const [account, setAccount] = useState<LinkedTikTok | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setAccount(await fetchLinkedTikTok());
    } catch {
      // A missing RPC just means the migration hasn't run; treat as not linked.
      setAccount(null);
    } finally {
      setLoading(false);
      setChecked(true);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { account, loading, checked, refresh };
}

// ---------------------------------------------------------------------------
// Link / unlink
// ---------------------------------------------------------------------------

/**
 * Opens TikTok's own login screen in a popup and resolves when the callback page
 * posts back. The user types their TikTok password into TikTok, never here.
 */
export async function linkTikTokAccount(): Promise<LinkedTikTok> {
  const start = await postJson<{ configured: boolean; url?: string; error?: string }>(
    "/api/tiktok/auth/url",
  );
  if (!start.configured || !start.url) {
    throw new Error(start.error || "TikTok linking isn't configured on this server.");
  }

  const width = 520;
  const height = 720;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  const popup = window.open(
    start.url,
    "tiktok-link",
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );
  if (!popup) throw new Error("Your browser blocked the TikTok window. Allow popups and try again.");

  return new Promise<LinkedTikTok>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      clearTimeout(timeout);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; error?: string; account?: unknown } | null;
      if (!data || typeof data.type !== "string") return;
      if (data.type === "TIKTOK_LINK_ERROR") {
        cleanup();
        reject(new Error(data.error || "TikTok sign-in did not complete."));
        return;
      }
      if (data.type === "TIKTOK_LINK_SUCCESS") {
        cleanup();
        // Re-read through the RPC rather than trusting the posted payload.
        fetchLinkedTikTok()
          .then((account) => {
            if (account) resolve(account);
            else reject(new Error("TikTok connected, but the account could not be read back."));
          })
          .catch(reject);
      }
    };

    window.addEventListener("message", onMessage);

    // If the popup is closed by hand, stop waiting instead of hanging forever.
    const poll = window.setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        reject(new Error("TikTok sign-in was canceled."));
      }
    }, 600);

    const timeout = window.setTimeout(
      () => {
        if (settled) return;
        cleanup();
        reject(new Error("TikTok sign-in timed out. Try again."));
      },
      10 * 60 * 1000,
    );
  });
}

export async function unlinkTikTokAccount(): Promise<void> {
  await postJson("/api/tiktok/unlink");
}

// ---------------------------------------------------------------------------
// Import the user's own videos
// ---------------------------------------------------------------------------

export type OwnTikTokVideo = {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  shareUrl: string | null;
  duration: number;
  createdAt: string | null;
};

export async function listMyTikTokVideos(cursor = 0): Promise<{
  username: string;
  videos: OwnTikTokVideo[];
  cursor: number;
  hasMore: boolean;
}> {
  const res = await fetch(`/api/tiktok/videos?cursor=${cursor}`, { headers: await authHeaders() });
  const json = (await res.json().catch(() => ({}))) as {
    username?: string;
    videos?: OwnTikTokVideo[];
    cursor?: number;
    hasMore?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(json.error || `Could not load your TikTok videos (${res.status})`);
  return {
    username: json.username ?? "",
    videos: json.videos ?? [],
    cursor: json.cursor ?? 0,
    hasMore: Boolean(json.hasMore),
  };
}

/**
 * Imports one of the user's own TikTok videos into their Coolerup feed.
 *
 * The row keeps TikTok provenance (`is_tiktok`, `tiktok_id`, `tiktok_author`), so
 * the existing card renders it with TikTok's own embed player — Coolerup never
 * downloads or rehosts the file.
 */
export async function importTikTokVideo(input: {
  video: OwnTikTokVideo;
  username: string;
  userId: string;
  caption?: string;
}): Promise<string> {
  const { video, username, userId } = input;
  const caption = (input.caption ?? video.description ?? video.title ?? "").trim();

  const { data: existing } = await supabase
    .from("videos")
    .select("id")
    .eq("tiktok_id", video.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from("videos")
    .insert({
      user_id: userId,
      username,
      caption,
      video_url: video.shareUrl ?? tiktokCanonicalUrl(username, video.id),
      is_tiktok: true,
      tiktok_id: video.id,
      tiktok_author: username,
    })
    .select("id")
    .single();
  if (error) throw error;

  await tiktokDatabase
    .from("tiktok_imports")
    .upsert(
      { user_id: userId, tiktok_id: video.id, video_id: data.id },
      { onConflict: "user_id,tiktok_id" },
    );

  return data.id;
}

/** Which of the user's own TikTok ids are already in Coolerup. */
export async function importedTikTokIds(): Promise<Set<string>> {
  const { data, error } = await tiktokDatabase.from("tiktok_imports").select("tiktok_id");
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.tiktok_id));
}

// ---------------------------------------------------------------------------
// Post to TikTok
// ---------------------------------------------------------------------------

export type PublishOutcome = { ok: boolean; mode: "direct" | "inbox"; message: string };

/**
 * Sends an already-uploaded Coolerup video to the linked TikTok account.
 *
 * Called after the upload succeeds, so a TikTok failure never loses the Coolerup
 * post — the video is already saved, and the error is reported separately.
 */
export async function publishVideoToTikTok(input: {
  videoId: string;
  caption: string;
}): Promise<PublishOutcome> {
  return postJson<PublishOutcome>("/api/tiktok/publish", input);
}

// ---------------------------------------------------------------------------
// Follower counts + sharing
// ---------------------------------------------------------------------------

/** How many Coolerup accounts follow this handle. */
export async function coolerupFollowerCount(username: string): Promise<number> {
  const { count, error } = await supabase
    .from("follows")
    .select("id", { count: "exact", head: true })
    .eq("following_username", username);
  if (error) return 0;
  return count ?? 0;
}

export function coolerupProfileUrl(username: string): string {
  const appUrl = (import.meta.env["VITE_APP_URL"] as string | undefined)?.replace(/\/+$/, "");
  const origin = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}/u/${encodeURIComponent(username)}`;
}

/**
 * Shares the Coolerup profile to TikTok.
 *
 * TikTok has no public "share a link into the app" API, so this uses the OS share
 * sheet where it exists (which lists TikTok on mobile) and otherwise copies the
 * link and opens TikTok so the user can paste it into a post or bio.
 */
export async function shareCoolerupToTikTok(username: string): Promise<"shared" | "copied"> {
  const url = coolerupProfileUrl(username);
  const text = `Follow me on Coolerup — @${username}`;

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: "Coolerup", text, url });
      return "shared";
    } catch (error) {
      // A user-cancelled share sheet is not a failure worth reporting.
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
    }
  }

  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
  } catch {
    /* clipboard blocked; the open below still helps */
  }
  window.open("https://www.tiktok.com/upload", "_blank", "noopener,noreferrer");
  return "copied";
}

/**
 * Shares the TikTok profile onto Coolerup.
 *
 * The Coolerup feed is video-only, so this posts a photo card built from the
 * user's TikTok avatar with the profile link in the caption. That keeps the
 * "share it to my feed" intent without inventing a text-post type.
 */
export async function shareTikTokToCoolerup(input: {
  username: string;
  coolerupUsername: string;
  userId: string;
  avatarUrl: string | null;
  caption?: string;
}): Promise<string> {
  const profile = tiktokCreatorUrl(input.username);
  const caption =
    (input.caption ?? "").trim() || `Find me on TikTok \u2192 ${profile}`;
  const image = input.avatarUrl || "/icon-512-coolerup.png";

  const { data, error } = await supabase
    .from("videos")
    .insert({
      user_id: input.userId,
      username: input.coolerupUsername,
      caption,
      video_url: image,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}
