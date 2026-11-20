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
  const raw = found ? found[0] : input.trim().replace(/^(?=(www\.|m\.|web\.)?facebook\.com|fb\.watch)/i, "https://");
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
