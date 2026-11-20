/**
 * Facebook videos are played ONLY through Facebook's official embed player.
 * We never download, proxy or re-upload the media; we just keep the link.
 */
const FB_HOSTS = ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"];

/** Accept only facebook.com / fb.watch video-ish URLs. Returns a clean https URL or null. */
export function normalizeFacebookVideoUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (!FB_HOSTS.includes(host)) return null;
    if (host === "fb.watch") return url.pathname.length > 1 ? `https://fb.watch${url.pathname}` : null;
    const path = url.pathname;
    const v = url.searchParams.get("v");
    if (path === "/watch" || path === "/watch/") return v && /^\d+$/.test(v) ? `https://www.facebook.com/watch/?v=${v}` : null;
    if (/\/(videos|reel|reels|watch)\/[^/]+/.test(path) || path === "/photo.php" || path === "/video.php") {
      if (path === "/video.php" && !(v && /^\d+$/.test(v))) return null;
      return `https://www.facebook.com${path}${path === "/video.php" ? `?v=${v}` : ""}`;
    }
    return null;
  }  catch {
    return null;
  }
}

export function buildFacebookEmbedUrl(videoUrl: string, width = 560): string {
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(videoUrl)}&show_text=false&width=${width}`;
}
