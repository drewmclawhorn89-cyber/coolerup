/** Accept only YouTube video URLs, never arbitrary hosts or embed HTML. */
export function extractYouTubeId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
    else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split("/")[2] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const youtubeThumbnail = (id: string) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
/** "PT1H2M3S" -> 3723. Returns null when the string isn't a duration. */
export function parseIsoDuration(value: string): number | null {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Math.round(Number(seconds ?? 0));
  return total > 0 ? total : null;
}

/**
 * Read a video's length (in seconds) out of a YouTube watch/embed page.
 *
 * YouTube's oEmbed endpoint returns the title, author and thumbnail but never
 * the duration, so the only cheap source is the page itself. The player config
 * carries `"lengthSeconds":"1234"`; older/leaner responses carry
 * `"approxDurationMs"`, and the microdata block carries an ISO 8601 duration.
 * Any of the three is good enough for a badge on a thumbnail.
 *
 * Returns null when the page is a consent wall, a bot check, or a live stream
 * with no fixed length — the caller then simply shows no badge.
 */
export function parseYouTubeDuration(html: string): number | null {
  if (!html) return null;

  const lengthSeconds = /"lengthSeconds"\s*:\s*"(\d{1,6})"/.exec(html);
  if (lengthSeconds) {
    const seconds = Number(lengthSeconds[1]);
    if (seconds > 0) return seconds;
  }

  const approxMs = /"approxDurationMs"\s*:\s*"(\d{1,10})"/.exec(html);
  if (approxMs) {
    const seconds = Math.round(Number(approxMs[1]) / 1000);
    if (seconds > 0) return seconds;
  }

  const microdata =
    /itemprop="duration"\s+content="([^"]+)"/.exec(html) ??
    /"duration"\s*:\s*"(P[0-9DTHMS.]+)"/.exec(html);
  if (microdata?.[1]) return parseIsoDuration(microdata[1]);

  return null;
}
