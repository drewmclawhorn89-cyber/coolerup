/**
 * TikTok URL handling and metadata normalisation.
 *
 * Pure functions only — no network, no React, no Supabase — so the sync job,
 * the admin panel and the tests all share one definition of "what is a TikTok
 * link". The server-side fetchers live in `tiktok.server.ts`.
 *
 * Playback rule: a TikTok video is never downloaded or rehosted. We keep the
 * canonical share URL plus the cover image and play the clip through TikTok's
 * own embed player, exactly like the YouTube additions do.
 */

export type TikTokVideoRef = {
  kind: "video";
  /** Numeric post id, e.g. "6718335390845095173". */
  id: string;
  /** Creator handle without the leading "@", when the URL carries one. */
  handle: string | null;
  /** Canonical https://www.tiktok.com/@handle/video/<id> URL. */
  url: string;
};

export type TikTokCreatorRef = {
  kind: "creator";
  handle: string;
  url: string;
};

export type TikTokHashtagRef = {
  kind: "hashtag";
  tag: string;
  url: string;
};

export type TikTokShortRef = {
  kind: "short";
  /** vm.tiktok.com / vt.tiktok.com short link, which only resolves over HTTP. */
  url: string;
};

export type TikTokRef = TikTokVideoRef | TikTokCreatorRef | TikTokHashtagRef | TikTokShortRef;

/** Hosts that serve TikTok content. */
const TIKTOK_HOSTS = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "www.vm.tiktok.com",
  "www.vt.tiktok.com",
]);

/** Handles are 2–24 characters: letters, numbers, underscore and period. */
const HANDLE_RE = /^[A-Za-z0-9._]{2,24}$/;
/** Post ids are numeric and long. */
const VIDEO_ID_RE = /^\d{6,25}$/;

export function isTikTokHost(hostname: string): boolean {
  return TIKTOK_HOSTS.has(hostname.toLowerCase());
}

export const tiktokCanonicalUrl = (handle: string | null, id: string): string =>
  handle
    ? `https://www.tiktok.com/@${encodeURIComponent(handle)}/video/${id}`
    : `https://www.tiktok.com/video/${id}`;

export const tiktokEmbedUrl = (id: string): string =>
  `https://www.tiktok.com/embed/v2/${encodeURIComponent(id)}`;

export const tiktokOEmbedUrl = (url: string): string =>
  `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;

export const tiktokCreatorUrl = (handle: string): string =>
  `https://www.tiktok.com/@${encodeURIComponent(handle)}`;

export const tiktokHashtagUrl = (tag: string): string =>
  `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`;

/**
 * Parse anything an admin might paste into a source row.
 *
 * Accepts full URLs (www / m / vm / vt), bare handles ("@cats" or "cats") and
 * bare numeric post ids. Returns null for anything else so a typo can never
 * turn into a request to a host we did not intend to talk to.
 */
export function parseTikTokInput(input: string): TikTokRef | null {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 2048) return null;

  // Bare post id.
  if (VIDEO_ID_RE.test(raw)) {
    return { kind: "video", id: raw, handle: null, url: tiktokCanonicalUrl(null, raw) };
  }

  // Bare handle.
  const bareHandle = raw.replace(/^@/, "");
  if (!raw.includes("/") && !raw.includes(".") && HANDLE_RE.test(bareHandle)) {
    return { kind: "creator", handle: bareHandle, url: tiktokCreatorUrl(bareHandle) };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!isTikTokHost(url.hostname)) return null;

  const host = url.hostname.toLowerCase();
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return { kind: "short", url: url.toString() };
  }

  const parts = url.pathname.split("/").filter(Boolean);

  // /@handle/video/<id> or /@handle/photo/<id>
  if (parts[0]?.startsWith("@")) {
    const handle = decodeURIComponent(parts[0].slice(1));
    const marker = parts[1];
    const id = parts[2] ?? "";
    if ((marker === "video" || marker === "photo") && VIDEO_ID_RE.test(id)) {
      const cleanHandle = HANDLE_RE.test(handle) ? handle : null;
      return {
        kind: "video",
        id,
        handle: cleanHandle,
        url: tiktokCanonicalUrl(cleanHandle, id),
      };
    }
    if (HANDLE_RE.test(handle)) {
      return { kind: "creator", handle, url: tiktokCreatorUrl(handle) };
    }
    return null;
  }

  // /tag/<tag>
  if (parts[0] === "tag" && parts[1]) {
    const tag = decodeURIComponent(parts[1]).replace(/^#/, "");
    if (/^[\p{L}\p{N}_]{1,100}$/u.test(tag)) {
      return { kind: "hashtag", tag, url: tiktokHashtagUrl(tag) };
    }
    return null;
  }

  // /video/<id> (rare, but some share sheets emit it)
  if (parts[0] === "video" && VIDEO_ID_RE.test(parts[1] ?? "")) {
    return { kind: "video", id: parts[1]!, handle: null, url: tiktokCanonicalUrl(null, parts[1]!) };
  }

  return null;
}

/** Pull a numeric post id out of an embed URL or embed HTML. */
export function tiktokIdFromEmbed(value: string): string | null {
  const match = /(?:embed\/v2\/|video\/)(\d{6,25})/.exec(value ?? "");
  return match?.[1] ?? null;
}

export type TikTokMetadata = {
  id: string;
  title: string;
  author: string;
  authorUrl: string;
  thumbnailUrl: string | null;
  /** Seconds; oEmbed does not report it, the Display API does. */
  duration: number;
  /** Canonical share URL. */
  url: string;
};

/**
 * Normalise TikTok's oEmbed payload.
 *
 * The endpoint returns `title` (the caption), `author_name`, `author_url`,
 * `author_unique_id` and a cover image. Anything unexpected is dropped rather
 * than trusted, so a shape change upstream degrades to "no title" instead of
 * writing garbage into the database.
 */
export function normalizeOEmbed(json: unknown, fallbackUrl: string): TikTokMetadata | null {
  if (!json || typeof json !== "object") return null;
  const row = json as {
    title?: unknown;
    author_name?: unknown;
    author_url?: unknown;
    author_unique_id?: unknown;
    thumbnail_url?: unknown;
    html?: unknown;
  };

  const author =
    typeof row.author_unique_id === "string" && row.author_unique_id.trim()
      ? row.author_unique_id.trim().replace(/^@/, "")
      : typeof row.author_name === "string"
        ? row.author_name.trim().replace(/^@/, "")
        : "";

  const authorUrl =
    typeof row.author_url === "string" && row.author_url.startsWith("https://")
      ? row.author_url
      : author
        ? tiktokCreatorUrl(author)
        : "";

  const thumbnailUrl =
    typeof row.thumbnail_url === "string" && /^https:\/\//.test(row.thumbnail_url)
      ? row.thumbnail_url
      : null;

  const idFromHtml = typeof row.html === "string" ? tiktokIdFromEmbed(row.html) : null;
  const idFromUrl = tiktokIdFromEmbed(fallbackUrl);
  const id = idFromHtml ?? idFromUrl;
  if (!id) return null;

  const title =
    typeof row.title === "string" && row.title.trim()
      ? row.title.trim().slice(0, 500)
      : `TikTok video · ${id}`;

  return {
    id,
    title,
    author: author || "tiktok",
    authorUrl: authorUrl || tiktokCreatorUrl(author || "tiktok"),
    thumbnailUrl,
    duration: 0,
    url: author ? tiktokCanonicalUrl(author, id) : tiktokCanonicalUrl(null, id),
  };
}

/**
 * Normalise one item from the official Display API (`/v2/video/list/`).
 *
 * Field names there are snake_case and the cover is `cover_image_url`. The
 * share URL is `share_url`, which is the canonical link we want to store.
 */
export function normalizeDisplayApiItem(json: unknown): TikTokMetadata | null {
  if (!json || typeof json !== "object") return null;
  const row = json as {
    id?: unknown;
    title?: unknown;
    video_description?: unknown;
    cover_image_url?: unknown;
    share_url?: unknown;
    duration?: unknown;
  };

  const id = typeof row.id === "string" ? row.id : "";
  if (!VIDEO_ID_RE.test(id)) return null;

  const shareUrl =
    typeof row.share_url === "string" && /^https:\/\/(www\.)?tiktok\.com\//.test(row.share_url)
      ? row.share_url
      : tiktokCanonicalUrl(null, id);

  const handleMatch = /@([A-Za-z0-9._]{2,24})/.exec(shareUrl);
  const author = handleMatch?.[1] ?? "";

  const cover =
    typeof row.cover_image_url === "string" && /^https:\/\//.test(row.cover_image_url)
      ? row.cover_image_url
      : null;

  const caption =
    typeof row.video_description === "string" && row.video_description.trim()
      ? row.video_description.trim()
      : typeof row.title === "string" && row.title.trim()
        ? row.title.trim()
        : "";

  const duration =
    typeof row.duration === "number" && row.duration > 0 ? Math.round(row.duration) : 0;

  return {
    id,
    title: (caption || `TikTok video · ${id}`).slice(0, 500),
    author: author || "tiktok",
    authorUrl: author ? tiktokCreatorUrl(author) : "https://www.tiktok.com",
    thumbnailUrl: cover,
    duration,
    url: shareUrl,
  };
}

/**
 * Best-effort discovery of `/video/<id>` links inside a creator profile page.
 *
 * This is the no-credentials fallback. TikTok often serves a login wall or a
 * bot check to server-side requests, in which case this simply returns an
 * empty list and the source records an honest "needs API access" note instead
 * of pretending it synced.
 */
export function extractVideoIdsFromProfileHtml(html: string, limit = 20): string[] {
  if (!html) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /\/@[A-Za-z0-9._]{2,24}\/video\/(\d{6,25})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && ids.length < limit) {
    const id = match[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Trim a caption down to something a card can render in one or two lines. */
export function shortCaption(title: string, max = 140): string {
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** One line of the bulk importer's report, shared by server and UI. */
export type TikTokImportOutcome = {
  input: string;
  status: "added" | "duplicate" | "invalid" | "unavailable" | "error";
  message: string;
  tiktokId: string | null;
};

/**
 * Split a pasted blob into individual links.
 *
 * Admins paste from a spreadsheet, a notes app, or straight off the share
 * sheet, so newlines, tabs, commas and spaces are all treated as separators.
 */
export function splitTikTokLinks(text: string): string[] {
  return (text ?? "")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
