import { supabase } from "@/integrations/supabase/client";

/**
 * Coolerup Browser
 * ----------------
 * A real, Coolerup-branded browser that lives inside the app. It is not a
 * Google embed: searching runs through Coolerup's own search backend and the
 * results are rendered with Coolerup's own result cards. Google is never shown
 * as the product — only as one of the places you can visit.
 *
 * This module owns every rule the UI needs and nothing else, so it can be unit
 * tested without a DOM:
 *
 *   * what the user meant by what they typed (URL vs search)
 *   * which shortcuts the home page shows
 *   * which sites are unsafe, and which refuse to be framed
 *   * how history and bookmarks are stored
 *
 * Safety model (this browser is used by minors inside a social app):
 *   * adult and gambling domains are blocked outright
 *   * executable downloads are blocked; only images may leave the sandbox
 *   * the iframe is sandboxed without `allow-downloads`
 *   * sites that refuse framing get a Coolerup popup with "Open outside"
 */

/* -------------------------------------------------------------------------- */
/* Branding                                                                   */
/* -------------------------------------------------------------------------- */

/** The Coolerup Browser blue, used for all chrome regardless of app theme. */
export const BROWSER_BLUE = "#2563EB";
export const BROWSER_BLUE_DEEP = "#1d4fc4";

/* -------------------------------------------------------------------------- */
/* Sites                                                                      */
/* -------------------------------------------------------------------------- */

export type BrowserSite = {
  id: string;
  label: string;
  emoji: string;
  /** Where the tab goes when tapped with no query. */
  home: string;
  /** Build a results URL for a query. Omitted for sites with no search. */
  search?: (query: string) => string;
};

const q = (query: string) => encodeURIComponent(query.trim());

/** Google's `igu=1` makes the results page embeddable; `safe=active` forces SafeSearch. */
export const GOOGLE_SEARCH = (query: string) =>
  `https://www.google.com/search?igu=1&safe=active&q=${q(query)}`;
export const GOOGLE_HOME = "https://www.google.com/webhp?igu=1";
export const GOOGLE_IMAGES = (query: string) =>
  `https://www.google.com/search?igu=1&safe=active&tbm=isch&q=${q(query)}`;
export const GOOGLE_MAPS = (query: string) => `https://www.google.com/maps/search/${q(query)}`;
export const GOOGLE_NEWS = (query: string) => `https://news.google.com/search?q=${q(query)}`;

/**
 * The strip inside the browser. "Coolerup" is the home page; the rest are
 * real sites. All of them are rendered in Coolerup chrome.
 */
export const COOLERUP_TABS: BrowserSite[] = [
  { id: "coolerup", label: "Coolerup", emoji: "🌐", home: "coolerup://home" },
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
    home: "https://en.wikipedia.org",
    search: (query) => `https://en.wikipedia.org/w/index.php?search=${q(query)}`,
  },
  { id: "news", label: "News", emoji: "📰", home: "https://news.google.com", search: GOOGLE_NEWS },
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
  COOLERUP_TABS.find((site) => site.id === id);

/** Where a site tab should go for the current query. */
export function urlForSite(site: BrowserSite, query = ""): string {
  const trimmed = query.trim();
  if (trimmed && site.search) return site.search(trimmed);
  return site.home;
}

/* -------------------------------------------------------------------------- */
/* Top tab strip — horizontal stepping                                        */
/* -------------------------------------------------------------------------- */

/** One tab as the strip lays it out: distance from the content's left edge, plus width. */
export type StripTab = { left: number; width: number };

/** How far the strip can scroll before it hits the end. */
export function stripMaxScroll(contentWidth: number, viewport: number): number {
  return Math.max(0, contentWidth - viewport);
}

/** Whether the strip is already hard against either end. */
export function stripEdges(
  scrollLeft: number,
  contentWidth: number,
  viewport: number,
): { atStart: boolean; atEnd: boolean } {
  const max = stripMaxScroll(contentWidth, viewport);
  return { atStart: scrollLeft <= 1, atEnd: scrollLeft >= max - 1 };
}

/**
 * Where the strip should scroll to when the user taps the left or right arrow.
 *
 * "right" jumps to the first tab that is not fully visible at the right edge;
 * "left" jumps to the last tab that is not fully visible at the left edge.
 * Either way the target tab is aligned with the start of the viewport and the
 * result is clamped so the strip never scrolls past its ends.
 */
export function stripStep(
  tabs: StripTab[],
  viewport: number,
  scrollLeft: number,
  direction: "left" | "right",
): { scrollLeft: number; index: number } {
  const max = stripMaxScroll(
    tabs.reduce((end, tab) => Math.max(end, tab.left + tab.width), 0),
    viewport,
  );
  const clamped = Math.min(Math.max(scrollLeft, 0), max);

  if (direction === "right") {
    const index = tabs.findIndex((tab) => tab.left + tab.width > clamped + viewport + 1);
    if (index === -1) return { scrollLeft: max, index: tabs.length - 1 };
    return { scrollLeft: Math.min(max, tabs[index]!.left), index };
  }

  // "left" mirrors it: jump back to the last tab that has scrolled fully past the
  // left edge, so one tap back undoes roughly one tap forward.
  let index = -1;
  for (let i = 0; i < tabs.length; i += 1) {
    if (tabs[i]!.left + tabs[i]!.width <= clamped + 1) index = i;
    else break;
  }
  if (index === -1) return { scrollLeft: 0, index: 0 };
  return { scrollLeft: Math.min(max, tabs[index]!.left), index };
}

/* -------------------------------------------------------------------------- */
/* Home page shortcuts                                                        */
/* -------------------------------------------------------------------------- */

export type Shortcut = {
  id: string;
  label: string;
  emoji: string;
  /** Either an in-app route (`internal`) or a site to open in the browser. */
  href: string;
  internal?: boolean;
  blurb: string;
};

/** The six cards on the Coolerup Browser home page. */
export const SHORTCUTS: Shortcut[] = [
  {
    id: "youtube",
    label: "YouTube",
    emoji: "▶️",
    href: "https://www.youtube.com",
    blurb: "Watch anything",
  },
  {
    id: "tiktok",
    label: "TikTok",
    emoji: "🎵",
    href: "https://www.tiktok.com",
    blurb: "For You, everywhere",
  },
  {
    id: "wikipedia",
    label: "Wikipedia",
    emoji: "📚",
    href: "https://en.wikipedia.org",
    blurb: "Look it up",
  },
  {
    id: "news",
    label: "News",
    emoji: "📰",
    href: "https://news.google.com",
    blurb: "What's happening",
  },
  {
    id: "music",
    label: "Music",
    emoji: "🎧",
    href: "/music",
    internal: true,
    blurb: "Your sounds",
  },
  {
    id: "shop",
    label: "Shop",
    emoji: "🛍️",
    href: "/coins/recharge",
    internal: true,
    blurb: "Coins & gifts",
  },
];

/* -------------------------------------------------------------------------- */
/* Framing + safety                                                           */
/* -------------------------------------------------------------------------- */

/** Adult / gambling domains. Matched on the registrable host, subdomains included. */
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

/** Extensions allowed to open outside the app. */
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

/** The path only — never the host, so a `.com` TLD is not read as a `.com` file. */
const pathnameOf = (url: string): string => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return (url.toLowerCase().split("?")[0] ?? "").replace(/^[a-z]+:\/\/[^/]+/i, "");
  }
};

const hostMatches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

/** True for `coolerup://home` style internal pages. */
export const isInternalUrl = (url: string) => url.startsWith("coolerup://");

/** Adult or otherwise unsafe destination. */
export function isBlockedUrl(url: string): boolean {
  if (isInternalUrl(url)) return false;
  const host = hostOf(url);
  if (!host) return false;
  if (BLOCKED_HOSTS.some((domain) => hostMatches(host, domain))) return true;
  const path = pathnameOf(url);
  return BLOCKED_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Hosts that are known to allow framing, and that look better raw than
 * sanitised. Everything else goes through the Coolerup proxy.
 *
 * This is an allowlist on purpose. A deny-list can never be complete — IMDb,
 * for example, blocks framing without advertising it — and every miss shows
 * the user a blank white rectangle. Defaulting to the proxy means a page
 * always renders something.
 */
const DIRECT_FRAME_HOSTS = [
  "wikipedia.org",
  "wikimedia.org",
  "wiktionary.org",
  "wikisource.org",
  "openstreetmap.org",
  "archive.org",
  "gutenberg.org",
];

const FRAME_FRIENDLY_PATHS = [/^\/search/, /^\/webhp/, /^\/imghp/, /^\/maps/, /^\/search\?/];

/** Whether the site can be dropped straight into an <iframe>. */
export function isEmbeddable(url: string): boolean {
  if (isInternalUrl(url)) return false;
  const host = hostOf(url);
  if (!host) return false;

  // Player embeds are built for framing, so they always stay inside Coolerup.
  if (embedUrlFor(url)) return true;

  if (DIRECT_FRAME_HOSTS.some((domain) => hostMatches(host, domain))) return true;

  const isGoogle = hostMatches(host, "google.com") || hostMatches(host, "google.co.uk");
  if (!isGoogle) return false;
  const path = pathnameOf(url) + (new URL(url).search ? `?${new URL(url).search.slice(1)}` : "");
  return FRAME_FRIENDLY_PATHS.some((re) => re.test(path));
}

/**
 * The player URL for a video link, or null.
 *
 * YouTube and TikTok both ship a frame-friendly player. Using it means a video
 * link pasted into Coolerup Browser actually plays inside the app instead of
 * bouncing out of Coolerup Browser.
 */
export function embedUrlFor(url: string): string | null {
  const youtubeId = youtubeIdFromBrowserUrl(url);
  if (youtubeId) return `https://www.youtube.com/embed/${youtubeId}?rel=0&playsinline=1`;

  const tiktokId = tiktokVideoId(url);
  if (tiktokId) return `https://www.tiktok.com/embed/v2/${tiktokId}`;

  return null;
}

/** TikTok video ids live in `/@user/video/<id>`. */
export function tiktokVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!hostMatches(host, "tiktok.com")) return null;
    const match = /\/video\/(\d{6,})/.exec(parsed.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Only images may leave the sandbox; everything else is refused. */
export function isAllowedDownload(url: string): boolean {
  const path = pathnameOf(url);
  return ALLOWED_DOWNLOAD_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/* -------------------------------------------------------------------------- */
/* Address bar                                                                */
/* -------------------------------------------------------------------------- */

export type ParsedInput =
  { kind: "url"; url: string } | { kind: "search"; query: string } | { kind: "empty" };

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+((:\d+)?)(\/.*)?$/i;

/**
 * Decide what the user meant by what they typed.
 *
 * - `https://…` / `http://…` → load it
 * - `youtube.com`, `wikipedia.org/wiki/X` → treat as a URL
 * - anything else (`mgk starman`) → Coolerup search
 */
export function parseInput(raw: string): ParsedInput {
  const input = raw.trim();
  if (!input) return { kind: "empty" };

  if (/^https?:\/\//i.test(input)) return { kind: "url", url: input };

  if (!/\s/.test(input) && DOMAIN_RE.test(input) && /\.[a-z]{2,}/i.test(input)) {
    return { kind: "url", url: `https://${input}` };
  }

  return { kind: "search", query: input };
}

/** Short label for a tab strip / history row. */
export function displayTitle(url: string): string {
  if (isInternalUrl(url)) return "Coolerup";
  const host = hostOf(url);
  if (!host) return "New tab";
  return host;
}

/** Pull a YouTube video id out of a link so it can go to Music. */
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

/** Anything typed in the address bar that is a YouTube link can go to Music. */
export function youtubeIdFromInput(raw: string): string | null {
  const parsed = parseInput(raw);
  return parsed.kind === "url" ? youtubeIdFromBrowserUrl(parsed.url) : null;
}

/* -------------------------------------------------------------------------- */
/* Search results                                                             */
/* -------------------------------------------------------------------------- */

export type SearchResult = {
  title: string;
  url: string;
  /** Plain-text snippet, already stripped of HTML. */
  snippet: string;
  /** Host shown under the title, e.g. `en.wikipedia.org`. */
  host: string;
};

export type SearchResponse =
  | {
      ok: true;
      results: SearchResult[];
      source: "google" | "bing" | "duckduckgo" | "wikipedia";
    }
  | { ok: false; reason: "empty" | "network" | "no-results" };

/** Host for display, without `www.`. */
export function hostLabel(url: string): string {
  return hostOf(url) || url;
}

/** One-line preview of a URL for the result card. */
export function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, "")}${path}`.slice(0, 90);
  } catch {
    return url.slice(0, 90);
  }
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

/* -------------------------------------------------------------------------- */
/* Downloads                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Downloads are Coolerup's own list, not Chrome's.
 *
 * The Android shell cannot hand arbitrary files to Chrome (that would escape
 * the sandbox), so Coolerup records what the person chose to keep and shows it
 * on the Downloads page. Only images are accepted — the same rule the sandbox
 * enforces — and the list is stored locally on the device.
 */
export type BrowserDownloadRow = {
  id: string;
  url: string;
  title: string;
  created_at: string;
};

const DOWNLOADS_KEY = "coolerup.browser.downloads";
const DOWNLOADS_LIMIT = 100;

const readDownloads = (): BrowserDownloadRow[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(DOWNLOADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is BrowserDownloadRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row as BrowserDownloadRow).id === "string" &&
        typeof (row as BrowserDownloadRow).url === "string",
    );
  } catch {
    return [];
  }
};

const writeDownloads = (rows: BrowserDownloadRow[]): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(rows.slice(0, DOWNLOADS_LIMIT)));
  } catch {
    /* storage full or disabled — downloads are a nicety, never fatal */
  }
};

/** Newest first. */
export function listDownloads(): BrowserDownloadRow[] {
  return readDownloads().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Record an image the person chose to keep. Returns null when refused. */
export function addDownload(url: string, title?: string): BrowserDownloadRow | null {
  if (!isAllowedDownload(url)) return null;
  const row: BrowserDownloadRow = {
    id: `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    url,
    title: (title || displayTitle(url)).slice(0, 120),
    created_at: new Date().toISOString(),
  };
  writeDownloads([row, ...readDownloads()]);
  return row;
}

export function removeDownload(id: string): void {
  writeDownloads(readDownloads().filter((row) => row.id !== id));
}

export function clearDownloads(): void {
  writeDownloads([]);
}
