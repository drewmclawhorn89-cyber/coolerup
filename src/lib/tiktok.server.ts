/**
 * Server-side TikTok fetchers.
 *
 * Two sources of truth, in order of preference:
 *
 *  1. The official Display API (`open.tiktokapis.com/v2/video/list/`). It needs
 *     a user access token in `TIKTOK_ACCESS_TOKEN` and only lists videos for
 *     accounts that authorised the app. When it is configured it is the only
 *     reliable way to discover *new* posts for a creator.
 *
 *  2. TikTok's public oEmbed endpoint (`/oembed?url=…`). No credentials, no
 *     scraping, and it is the endpoint TikTok publishes for embedding. It
 *     returns the caption, author and cover for one known video URL — which is
 *     all we need to turn a pasted link into a library row.
 *
 * A creator profile page is read only as a last-resort hint for video ids; if
 * TikTok serves a login wall the helper returns an empty list and the caller
 * records an honest reason rather than inventing rows.
 *
 * Nothing here downloads a video file. We store the share URL and the cover and
 * play through TikTok's embed player.
 */
import {
  extractVideoIdsFromProfileHtml,
  normalizeDisplayApiItem,
  normalizeOEmbed,
  parseTikTokInput,
  tiktokCanonicalUrl,
  tiktokEmbedUrl,
  tiktokOEmbedUrl,
  type TikTokMetadata,
  type TikTokRef,
} from "./tiktok";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TIMEOUT_MS = 8_000;

export type TikTokFetchResult = {
  items: TikTokMetadata[];
  /** Why the list is empty or partial, for the admin panel / run log. */
  reason?: string;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function hasDisplayApiToken(): boolean {
  return Boolean(process.env["TIKTOK_ACCESS_TOKEN"]);
}

/**
 * Ask oEmbed about one video URL. Returns null on any failure — a bot check, a
 * deleted post or a network blip all mean "skip this one", never a crash.
 */
export async function fetchOEmbed(url: string): Promise<TikTokMetadata | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(tiktokOEmbedUrl(url), {
        headers: {
          "user-agent": DESKTOP_UA,
          accept: "application/json",
          "accept-language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 0) {
          await sleep(1200);
          continue;
        }
        return null;
      }
      if (!response.ok) return null;
      const json: unknown = await response.json();
      return normalizeOEmbed(json, url);
    } catch {
      if (attempt === 0) {
        await sleep(600);
        continue;
      }
      return null;
    }
  }
  return null;
}

/** Follow a vm.tiktok.com / vt.tiktok.com short link to its canonical target. */
export async function resolveShortLink(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": DESKTOP_UA, accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const finalUrl = response.url;
    return finalUrl && finalUrl !== url ? finalUrl : null;
  } catch {
    return null;
  }
}

/**
 * List a creator's recent videos through the official Display API.
 *
 * `fields` is required by the endpoint; `max_count` is capped at 20 by TikTok.
 */
async function listViaDisplayApi(handle: string, limit: number): Promise<TikTokFetchResult> {
  const token = process.env["TIKTOK_ACCESS_TOKEN"];
  if (!token) return { items: [], reason: "no_token" };

  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,cover_image_url,share_url,duration,create_time",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ max_count: Math.min(Math.max(limit, 1), 20) }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      return { items: [], reason: `display_api_${response.status}` };
    }
    const json = (await response.json()) as {
      data?: { videos?: unknown[] };
      error?: { code?: string; message?: string };
    };
    if (json.error?.code && json.error.code !== "ok") {
      return { items: [], reason: `display_api_${json.error.code}` };
    }
    const items = (json.data?.videos ?? [])
      .map(normalizeDisplayApiItem)
      .filter((item): item is TikTokMetadata => item !== null)
      .slice(0, limit);

    // The Display API lists the token owner's videos. If the handle we are
    // watching is someone else, say so instead of silently syncing the wrong
    // account's posts.
    const mismatch =
      items.length > 0 && !items.some((i) => i.author.toLowerCase() === handle.toLowerCase());
    if (mismatch) {
      return {
        items: [],
        reason: `token_belongs_to_@${items[0]!.author}`,
      };
    }
    return items.length ? { items } : { items, reason: "no_videos" };
  } catch {
    return { items: [], reason: "display_api_unreachable" };
  }
}

/**
 * Last-resort discovery: read the profile page and pull `/video/<id>` links.
 * Best effort only — TikTok frequently answers with a login wall.
 */
async function listViaProfilePage(handle: string, limit: number): Promise<TikTokFetchResult> {
  try {
    const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      headers: {
        "user-agent": DESKTOP_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { items: [], reason: `profile_${response.status}` };
    const html = await response.text();
    const ids = extractVideoIdsFromProfileHtml(html, limit);
    if (ids.length === 0) return { items: [], reason: "profile_no_video_ids" };

    const items: TikTokMetadata[] = [];
    for (const id of ids) {
      const meta = await fetchOEmbed(tiktokCanonicalUrl(handle, id));
      if (meta) items.push(meta);
      await sleep(400);
    }
    return items.length ? { items } : { items, reason: "profile_metadata_unavailable" };
  } catch {
    return { items: [], reason: "profile_unreachable" };
  }
}

/**
 * Resolve one source row into the videos it currently exposes.
 *
 * - `video`   → exactly that post (oEmbed)
 * - `creator` → Display API when a token exists, profile page otherwise
 * - `hashtag` → not supported without the Research API; reported, not faked
 */
export async function listSourceVideos(ref: TikTokRef, limit: number): Promise<TikTokFetchResult> {
  if (ref.kind === "video") {
    const meta = await fetchOEmbed(ref.url);
    return meta ? { items: [meta] } : { items: [], reason: "oembed_unavailable" };
  }

  if (ref.kind === "short") {
    const resolved = await resolveShortLink(ref.url);
    const parsed = resolved ? parseTikTokInput(resolved) : null;
    if (!parsed) return { items: [], reason: "short_link_unresolved" };
    return listSourceVideos(parsed, limit);
  }

  if (ref.kind === "creator") {
    if (hasDisplayApiToken()) {
      const viaApi = await listViaDisplayApi(ref.handle, limit);
      if (viaApi.items.length > 0) return viaApi;
      // Token present but the account is not the token owner: fall back to the
      // public page rather than giving up on the source entirely.
      const viaPage = await listViaProfilePage(ref.handle, limit);
      return viaPage.items.length > 0
        ? viaPage
        : { items: [], reason: viaApi.reason ?? "creator_discovery_unavailable" };
    }
    return listViaProfilePage(ref.handle, limit);
  }

  return { items: [], reason: "hashtag_sources_need_research_api" };
}

/** True when this deployment can discover new posts for a creator. */
export function tiktokDiscoveryStatus(): {
  displayApi: boolean;
  mode: "display_api" | "public_pages";
} {
  return hasDisplayApiToken()
    ? { displayApi: true, mode: "display_api" }
    : { displayApi: false, mode: "public_pages" };
}

/** The URL an embed player should load for a stored row. */
export function tiktokPlaybackUrl(tiktokId: string): string {
  return tiktokEmbedUrl(tiktokId);
}
