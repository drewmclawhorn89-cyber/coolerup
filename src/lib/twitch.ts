export type TwitchStream = {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  title: string;
  viewer_count: number;
  thumbnail_url: string;
  started_at?: string;
  avatar_url?: string | null;
};

export type TwitchGame = {
  id: string;
  name: string;
  box_art_url: string;
};

export type TwitchUser = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
};

export type TwitchStreamsResponse = {
  configured: boolean;
  streams: TwitchStream[];
  games: TwitchGame[];
  error?: string;
};

export function formatViewerCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  if (count >= 1_000_000) {
    const val = (count / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `${val}M`;
  }
  if (count >= 1_000) {
    const val = (count / 1_000).toFixed(1).replace(/\.0$/, "");
    return `${val}K`;
  }
  return String(Math.floor(count));
}

export function formatTwitchThumbnail(url: string, width: number, height: number): string {
  if (!url) return "";
  return url
    .replace("{width}", String(width))
    .replace("{height}", String(height))
    .replace("%7Bwidth%7D", String(width))
    .replace("%7Bheight%7D", String(height));
}

export function normalizeTwitchChannel(input: string): string {
  const trimmed = input.trim().replace(/^@+/, "");
  if (!trimmed) return "";
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([a-zA-Z0-9_]+)/i);
  const raw = urlMatch?.[1] ?? trimmed;
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export function buildTwitchParentParams(
  hostname: string,
  ancestorOrigins?: readonly string[] | DOMStringList | null,
): string[] {
  const parents = new Set<string>();
  const cleanHost = hostname.trim().toLowerCase();
  if (cleanHost) parents.add(cleanHost);

  if (ancestorOrigins) {
    for (let i = 0; i < ancestorOrigins.length; i += 1) {
      const origin = ancestorOrigins[i];
      if (!origin) continue;
      try {
        const host = new URL(origin).hostname.trim().toLowerCase();
        if (host) parents.add(host);
      } catch {
        // Ignore opaque or malformed ancestor origins.
      }
    }
  }

  if (parents.size === 0) {
    parents.add("localhost");
  }

  return Array.from(parents);
}

export function buildTwitchPlayerEmbedUrl(channel: string, parents: string[]): string {
  const clean = normalizeTwitchChannel(channel);
  const params = new URLSearchParams({
    channel: clean,
    autoplay: "true",
    muted: "false",
  });
  for (const parent of parents) {
    if (parent) params.append("parent", parent);
  }
  return `https://player.twitch.tv/?${params.toString()}`;
}

export function buildTwitchChatEmbedUrl(channel: string, parents: string[]): string {
  const clean = normalizeTwitchChannel(channel);
  const params = new URLSearchParams({
    darkpopout: "",
  });
  for (const parent of parents) {
    if (parent) params.append("parent", parent);
  }
  return `https://www.twitch.tv/embed/${encodeURIComponent(clean)}/chat?${params.toString()}`;
}
