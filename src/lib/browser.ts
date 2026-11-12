import { supabase } from "@/integrations/supabase/client";

/**
 * In-app browser
 * --------------
 * A Chrome-ish browser that lives inside Coolerup: a Google-style search pill,
 * a row of site tabs (Google / YouTube / TikTok / Wikipedia / News / Images /
 * Maps), back / forward / refresh / home, multiple tabs, history and bookmarks.
 *
 * Everything here is pure so it can be unit tested without a DOM. The route and
 * components own the rendering; this module owns the rules.
 *
 * Two hard constraints shape the design:
 *
 * 1. **Framing.** Most big sites send `X-Frame-Options: DENY` or a
 *    `frame-ancestors` CSP, so an <iframe> simply cannot show them. We cannot
 *    read the frame's document to detect that (cross-origin), so we keep a
 *    list of hosts known to refuse framing and offer "Open in Chrome" up front
 *    instead of showing the user a blank box.
 *
 * 2. **Safety.** This is a browser inside a social app used by minors, so
 *    adult domains are blocked outright, SafeSearch is forced on for Google,
 *    and the frame is sandboxed without `allow-downloads` so nothing can be
 *    dropped on the device. Only image URLs are allowed to open in a new tab.
 */

/** One of the site tabs above the browser viewport. */
export type BrowserSite = {
  id: string;
  label: string;
  /** Short glyph shown in the tab strip. */
  emoji: string;
  /** Where the tab goes when tapped with no query. */
  home: string;
  /** Build a results URL for a query. Omitted when the site has no search. */
  search?: (query: string) => string;
};

const q = (query: string) => encodeURIComponent(query.trim());

/**
 * Google's `igu=1` parameter makes the results page embeddable in a frame, and
 * `safe=active` forces SafeSearch on regardless of the visitor's cookies.
 */
export const GOOGLE_SEARCH = (query: string) =>
  `https://www.google.com/search?igu=1&safe=active&q=${q(query)}`;

export const GOOGLE_HOME = "https://www.google.com/webhp?igu=1";
export const GOOGLE_IMAGES = (query: string) =>
  `https://www.google.com/search?igu=1&safe=active&tbm=isch&q=${q(query)}`;
export const GOOGLE_MAPS = (query: string) => `https://www.google.com/maps/search/${q(query)}`;
export const GOOGLE_NEWS = (query: string) => `https://news.google.com/search?q=${q(query)}`;

export const BROWSER_SITES: BrowserSite[] = [
  { id: "google", label: "Google", emoji: "🔍", home: GOOGLE_HOME, search: GOOGLE_SEARCH },
  {
    id: "youtube",
    label: "YouTube",
    emoji: "▶️",
    home: "https://www.youtube.com",
    search: (query) => `https://www.youtube.com/results?search_query=${q(query)}`,
  },
  {
    id: "tiktok",
    label: "TikTok",
    emoji: "🎵",
    home: "https://www.tiktok.com",
    search: (query) => `https://www.tiktok.com/search?q=${q(query)}`,
  },
  {
    id: "wikipedia",
    label: "Wikipedia",
    emoji: "📚",
    home: "https://www.wikipedia.org",
    search: (query) => `https://en.wikipedia.org/w/index.php?search=${q(query)}`,
  },
  {
    id: "news",
    label: "News",
    emoji: "📰",
    home: "https://news.google.com",
    search: GOOGLE_NEWS,
  },
  {
    id: "images",
    label: "Images",
    emoji: "🖼️",
    home: "https://www.google.com/imghp?igu=1",
    search: GOOGLE_IMAGES,
  },
  {
    id: "maps",
    label: "Maps",
    emoji: "🗺️",
    home: "https://www.google.com/maps",
    search: GOOGLE_MAPS,
  },
];

export const siteById = (id: string): BrowserSite | undefined =>
  BROWSER_SITES.find((site) => site.id === id);

/**
 * Hosts that refuse to be framed. Opening them in the viewport would show a
 * blank rectangle, so we surface "Open in Chrome" instead.
 */
const FRAME_REFUSING_HOSTS = [
  "google.com",
  "google.co.uk",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "amazon.com",
  "netflix.com",
  "spotify.com",
  "reddit.com",
  "linkedin.com",
  "paypal.com",
  "apple.com",
  "microsoft.com",
  "chatgpt.com",
  "openai.com",
  "discord.com",
  "twitch.tv",
  "pinterest.com",
  "snapchat.com",
  "whatsapp.com",
  "gmail.com",
  "outlook.com",
  "yahoo.com",
];

/**
 * Google's `igu=1` pages and the maps/news endpoints are the exceptions: they
 * are served in a frame-friendly mode, so they stay inside the viewport.
 */
const FRAME_FRIENDLY_PATHS = [/^\/search/, /^\/webhp/, /^\/imghp/, /^\/maps/, /^\/search\?/];

/** Adult / unsafe domains. Matched on the registrable host, subdomains included. */
const BLOCKED_HOSTS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "redtube.com",
  "youporn.com",
  "onlyfans.com",
  "chaturbate.com",
  "brazzers.com",
  "spankbang.com",
  "eporner.com",
  "beeg.com",
  "txxx.com",
  "hclips.com",
  "motherless.com",
  "literotica.com",
  "adultfriendfinder.com",
  "livejasmin.com",
  "stripchat.com",
  "cam4.com",
  "bongacams.com",
  "myfreecams.com",
  "fapello.com",
  "erome.com",
  "nhentai.net",
  "rule34.xxx",
  "e621.net",
  "betting.com",
  "1xbet.com",
  "bet365.com",
];

/** File types the browser will never hand to the OS. */
const BLOCKED_EXTENSIONS = [
  ".apk",
  ".apks",
  ".aab",
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".jar",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".iso",
  ".vbs",
  ".ps1",
  ".sh",
];

/** Extensions we do allow to open outside the app. */
const ALLOWED_DOWNLOAD_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".bmp",
];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname + (new URL(url).search ? `?${new URL(url).search.slice(1)}` : "");
  } catch {
    return "";
  }
};

/** True when `host` is `domain` or a subdomain of it. */
const hostMatches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

/** The path only — never the host, so a `.com` TLD is not read as a `.com` file. */
const pathnameOf = (url: string): string => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return (url.toLowerCase().split("?")[0] ?? "").replace(/^[a-z]+:\/\/[^/]+/i, "");
  }
};

/** Adult or otherwise unsafe destination. */
export function isBlockedUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (BLOCKED_HOSTS.some((domain) => hostMatches(host, domain))) return true;
  const path = pathnameOf(url);
  return BLOCKED_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Whether the site will actually render inside an <iframe>. Google's
 * frame-friendly endpoints are allowed through; everything else on the
 * refusing list is not.
 */
export function isEmbeddable(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const onRefusingHost = FRAME_REFUSING_HOSTS.some((domain) => hostMatches(host, domain));
  if (!onRefusingHost) return true;
  const isGoogle = hostMatches(host, "google.com") || hostMatches(host, "google.co.uk");
  if (!isGoogle) return false;
  const path = pathOf(url);
  return FRAME_FRIENDLY_PATHS.some((re) => re.test(path));
}

/** Only images may leave the sandbox; everything else is refused. */
export function isAllowedDownload(url: string): boolean {
  const path = pathnameOf(url);
  return ALLOWED_DOWNLOAD_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export type ParsedInput =
  { kind: "url"; url: string } | { kind: "search"; query: string; url: string } | { kind: "empty" };

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;

/**
 * Decide what the user meant by what they typed.
 *
 * - `https://…` / `http://…` → load it
 * - `youtube.com`, `wikipedia.org/wiki/X` → treat as a URL
 * - anything else (`mgk starman`) → Google search
 */
export function parseInput(raw: string): ParsedInput {
  const input = raw.trim();
  if (!input) return { kind: "empty" };

  if (/^https?:\/\//i.test(input)) {
    return { kind: "url", url: input };
  }

  // A bare domain: no spaces, has a dot, and the TLD is alphabetic.
  if (!/\s/.test(input) && DOMAIN_RE.test(input) && /\.[a-z]{2,}/i.test(input)) {
    return { kind: "url", url: `https://${input}` };
  }

  return { kind: "search", query: input, url: GOOGLE_SEARCH(input) };
}

/** Where a site tab should go for the current query. */
export function urlForSite(site: BrowserSite, query = ""): string {
  const trimmed = query.trim();
  if (trimmed && site.search) return site.search(trimmed);
  return site.home;
}

/** Short label for a tab strip / history row. */
export function displayTitle(url: string): string {
  const host = hostOf(url);
  if (!host) return "New tab";
  return host;
}

/** Pull a YouTube video id out of a pasted link so it can go to Music. */
export function youtubeIdFromBrowserUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return parsed.pathname.split("/")[1] || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] || null;
      if (parsed.pathname.startsWith("/embed/")) return parsed.pathname.split("/")[2] || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Anything typed in the search pill that is a YouTube link can go to Music. */
export function youtubeIdFromInput(raw: string): string | null {
  const parsed = parseInput(raw);
  if (parsed.kind === "url") return youtubeIdFromBrowserUrl(parsed.url);
  return null;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

export const HISTORY_LIMIT = 20;

export type BrowserHistoryRow = {
  id: string;
  user_id: string | null;
  query: string | null;
  url: string | null;
  created_at: string;
};

export type BrowserBookmarkRow = {
  id: string;
  user_id: string;
  url: string;
  title: string;
  created_at: string;
};

/** Record a visit. Silently no-ops when signed out or offline. */
export async function saveHistory(entry: { query?: string; url: string }): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    await supabase.from("browser_history").insert({
      user_id: userId,
      query: entry.query ?? null,
      url: entry.url,
    });
  } catch {
    /* history is a nicety; never break browsing over it */
  }
}

/** Most recent visits, newest first. */
export async function listHistory(limit = HISTORY_LIMIT): Promise<BrowserHistoryRow[]> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from("browser_history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as BrowserHistoryRow[];
}

export async function clearHistory(): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return;
  await supabase.from("browser_history").delete().eq("user_id", userId);
}

export async function listBookmarks(): Promise<BrowserBookmarkRow[]> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return [];
  const { data, error } = await supabase
    .from("browser_bookmarks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as BrowserBookmarkRow[];
}

/** Save a site. Returns false when signed out. */
export async function addBookmark(url: string, title: string): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return false;
  const { error } = await supabase
    .from("browser_bookmarks")
    .insert({ user_id: userId, url, title: title.slice(0, 120) });
  return !error;
}

export async function removeBookmark(id: string): Promise<void> {
  await supabase.from("browser_bookmarks").delete().eq("id", id);
}
