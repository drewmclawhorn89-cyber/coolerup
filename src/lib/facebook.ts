/**
 * Facebook videos are played ONLY through Facebook's official embed player.
 * We never download, proxy or re-upload the media; we just keep the link.
 */
const FB_HOSTS = [
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
  "fb.watch",
];
/** Query params that identify the content; everything else (tracking) is dropped. */
const KEEP_PARAMS = ["v", "story_fbid", "id", "fbid", "set"];

/**
 * Accept any facebook.com / fb.watch link (video, reel, watch, share/v, share/r,
 * posts, ...) and return a clean https URL, or null if it isn't a Facebook link.
 * Surrounding text is tolerated, so pasting "check this out https://fb.watch/x" works.
 */
export function normalizeFacebookVideoUrl(input: string): string | null {
  const found = /https?:\/\/[^\s<>"']+/i.exec(input.trim());
  const raw = found
    ? found[0]
    : input.trim().replace(/^(?=(www\.|m\.|web\.)?facebook\.com|fb\.watch)/i, "https://");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (!FB_HOSTS.includes(host)) return null;
    if (url.pathname.replace(/\//g, "") === "") return null;
    const base = host === "fb.watch" ? "fb.watch" : "www.facebook.com";
    const clean = new URL(`https://${base}${url.pathname}`);
    for (const key of KEEP_PARAMS) {
      const val = url.searchParams.get(key);
      if (val) clean.searchParams.set(key, val);
    }
    return clean.toString();
  } catch {
    return null;
  }
}

export function buildFacebookEmbedUrl(videoUrl: string, width = 560): string {
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(videoUrl)}&show_text=false&width=${width}`;
}

/** True for links Facebook only knows how to resolve server-side (short / share links). */
export function needsFacebookResolve(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "fb.watch" || /^\/share\//.test(u.pathname);
  } catch {
    return false;
  }
}

/** Facebook bounces logged-out visitors to /login/?next=<real url>; recover the real url. */
export function unwrapFacebookLoginRedirect(location: string): string {
  let current = location;
  for (let i = 0; i < 5; i++) {
    try {
      const u = new URL(current);
      if (!/^\/login/.test(u.pathname)) return current;
      const next = u.searchParams.get("next");
      if (!next) return current;
      current = next;
    } catch {
      return current;
    }
  }
  return current;
}

/** Pull the canonical video url out of a Facebook page's og:url / canonical tag. */
export function extractFacebookCanonical(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return m[1].replace(/&/g, "&");
  }
  return null;
}

export const FACEBOOK_HOME_URL = "https://m.facebook.com/";
export const FACEBOOK_WATCH_URL = "https://m.facebook.com/watch/";
export const FACEBOOK_REELS_URL = "https://m.facebook.com/reel/";
export const FACEBOOK_DESKTOP_HOME_URL = "https://www.facebook.com/";

/** Swap between mobile (`m.facebook.com`) and desktop (`www.facebook.com`) while preserving path & query. */
export function setFacebookHostMode(url: string, mobile: boolean): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("facebook.com"))
      return mobile ? FACEBOOK_HOME_URL : FACEBOOK_DESKTOP_HOME_URL;
    parsed.hostname = mobile ? "m.facebook.com" : "www.facebook.com";
    return parsed.toString();
  } catch {
    return mobile ? FACEBOOK_HOME_URL : FACEBOOK_DESKTOP_HOME_URL;
  }
}

export function isMobileFacebookUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "m.facebook.com" || host === "mbasic.facebook.com" || host === "touch.facebook.com"
    );
  } catch {
    return true;
  }
}

/** Turn user input in the Facebook tab bar into an in-app Facebook URL (link or Facebook search). */
export function resolveFacebookBarInput(input: string, mobile = true): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const videoOrPost = normalizeFacebookVideoUrl(trimmed);
  if (videoOrPost) {
    return setFacebookHostMode(videoOrPost, mobile);
  }
  const baseHost = mobile ? "m.facebook.com" : "www.facebook.com";
  try {
    const maybeUrl = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : /^(?:www\.|m\.|web\.|mbasic\.)?facebook\.com(?:\/|$)/i.test(trimmed)
        ? new URL(`https://${trimmed}`)
        : null;
    if (
      maybeUrl &&
      (maybeUrl.hostname.toLowerCase().endsWith("facebook.com") ||
        maybeUrl.hostname.toLowerCase() === "fb.watch")
    ) {
      return maybeUrl.toString();
    }
  } catch {
    // Fall through to search URL
  }
  return `https://${baseHost}/search/top/?q=${encodeURIComponent(trimmed)}`;
}

export function formatFacebookDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path =
      parsed.pathname === "/" && !parsed.search ? "" : `${parsed.pathname}${parsed.search}`;
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}
