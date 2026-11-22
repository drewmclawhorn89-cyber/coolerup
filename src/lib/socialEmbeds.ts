/**
 * Official embed players for the social apps on the Coolerup "More" page.
 *
 * Every helper here returns a URL that the network itself publishes for
 * embedding. Nothing is downloaded, proxied or re-uploaded: the app's own
 * player renders inside an <iframe> so views, ads and attribution stay with
 * the original platform.
 */

export type SocialAppId =
  | "facebook"
  | "tiktok"
  | "twitch"
  | "x"
  | "instagram"
  | "youtube"
  | "snapchat"
  | "reddit"
  | "pinterest";

export type SocialApp = {
  id: SocialAppId;
  name: string;
  /** One-line description shown under the name on the tile. */
  tagline: string;
  /** Brand colour used for the tile badge. */
  color: string;
  /** Whether the network publishes an embeddable player. */
  embeddable: boolean;
  /** Where the "Open in App" button goes. */
  webUrl: string;
  /** Placeholder for the link field in the player view. */
  placeholder: string;
  /** A public link that loads something useful the moment the app is opened. */
  defaultInput?: string;
};

export const SOCIAL_APPS: readonly SocialApp[] = [
  {
    id: "facebook",
    name: "Facebook",
    tagline: "Pages & videos",
    color: "#1877F2",
    embeddable: true,
    webUrl: "https://www.facebook.com/",
    placeholder: "Paste a Facebook page, video or reel link",
    defaultInput: "https://www.facebook.com/facebook",
  },
  {
    id: "tiktok",
    name: "TikTok",
    tagline: "Short videos",
    color: "#FE2C55",
    embeddable: true,
    webUrl: "https://www.tiktok.com/",
    placeholder: "Paste a TikTok video link",
    defaultInput: "https://www.tiktok.com/@tiktok/video/6718335390845095173",
  },
  {
    id: "twitch",
    name: "Twitch",
    tagline: "Live streams",
    color: "#9146FF",
    embeddable: true,
    webUrl: "https://www.twitch.tv/",
    placeholder: "Paste a Twitch channel link",
    defaultInput: "https://www.twitch.tv/twitch",
  },
  {
    id: "x",
    name: "X",
    tagline: "Posts & timelines",
    color: "#000000",
    embeddable: true,
    webUrl: "https://x.com/",
    placeholder: "Paste a post link or @handle",
    defaultInput: "https://x.com/jack/status/20",
  },
  {
    id: "instagram",
    name: "Instagram",
    tagline: "Posts & reels",
    color: "#E1306C",
    embeddable: true,
    webUrl: "https://www.instagram.com/",
    placeholder: "Paste an Instagram post or reel link",
    defaultInput: "https://www.instagram.com/p/BsOGulcndj-/",
  },
  {
    id: "youtube",
    name: "YouTube",
    tagline: "Videos & shorts",
    color: "#FF0000",
    embeddable: true,
    webUrl: "https://www.youtube.com/",
    placeholder: "Paste a YouTube video or Shorts link",
    defaultInput: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  },
  {
    id: "snapchat",
    name: "Snapchat",
    tagline: "Stories & snaps",
    color: "#FFFC00",
    embeddable: false,
    webUrl: "https://www.snapchat.com/",
    placeholder: "",
  },
  {
    id: "reddit",
    name: "Reddit",
    tagline: "Communities",
    color: "#FF4500",
    embeddable: false,
    webUrl: "https://www.reddit.com/",
    placeholder: "",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    tagline: "Ideas & pins",
    color: "#E60023",
    embeddable: false,
    webUrl: "https://www.pinterest.com/",
    placeholder: "",
  },
] as const;

export function socialApp(id: SocialAppId): SocialApp {
  const app = SOCIAL_APPS.find((a) => a.id === id);
  if (!app) throw new Error(`Unknown social app: ${id}`);
  return app;
}

/* -------------------------------------------------------------------------- */
/* Link parsing                                                               */
/* -------------------------------------------------------------------------- */

function safeUrl(raw: string): URL | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

function bareHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** `youtube.com/watch?v=…`, `youtu.be/…`, `/shorts/…`, `/embed/…` or a raw id. */
export function youtubeVideoId(raw: string): string | null {
  const value = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (bareHost(host, "youtu.be")) {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (!bareHost(host, "youtube.com") && !bareHost(host, "youtube-nocookie.com")) return null;
  const v = url.searchParams.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  const match = /\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  return match?.[1] ?? null;
}

/** `tiktok.com/@user/video/<id>` or a raw numeric id. */
export function tiktokVideoId(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{6,}$/.test(value)) return value;
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!bareHost(host, "tiktok.com")) return null;
  const match = /\/video\/(\d{6,})/.exec(url.pathname);
  return match?.[1] ?? null;
}

/** Post id from `x.com/user/status/<id>` / `twitter.com/user/status/<id>`. */
export function tweetId(raw: string): string | null {
  const value = raw.trim();
  if (/^\d+$/.test(value)) return value;
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!bareHost(host, "x.com") && !bareHost(host, "twitter.com")) return null;
  const match = /\/status(?:es)?\/(\d+)/.exec(url.pathname);
  return match?.[1] ?? null;
}

/** Handle from `x.com/<handle>`, `twitter.com/<handle>` or `@handle`. */
export function xHandle(raw: string): string | null {
  const value = raw.trim();
  const at = /^@([A-Za-z0-9_]{1,15})$/.exec(value);
  if (at) return at[1] ?? null;
  if (/^[A-Za-z0-9_]{1,15}$/.test(value)) return value;
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!bareHost(host, "x.com") && !bareHost(host, "twitter.com")) return null;
  const first = url.pathname.split("/").filter(Boolean)[0];
  if (!first || ["i", "home", "explore", "search", "hashtag", "intent"].includes(first))
    return null;
  return /^[A-Za-z0-9_]{1,15}$/.test(first) ? first : null;
}

/** Shortcode from `instagram.com/p|reel|tv/<code>`. */
export function instagramShortcode(
  raw: string,
): { kind: "p" | "reel" | "tv"; code: string } | null {
  const url = safeUrl(raw.trim());
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!bareHost(host, "instagram.com") && !bareHost(host, "instagr.am")) return null;
  const match = /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  const kind = match[1] === "reels" ? "reel" : (match[1] as "p" | "reel" | "tv");
  return { kind, code: match[2] };
}

/** Facebook page slug, or the full URL when it is a video/reel/watch link. */
export function facebookTarget(raw: string): { kind: "page" | "video"; url: string } | null {
  const value = raw.trim();
  if (!value) return null;
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!bareHost(host, "facebook.com") && !bareHost(host, "fb.com") && !bareHost(host, "fb.watch")) {
    return null;
  }
  const path = url.pathname.toLowerCase();
  const isVideo =
    host === "fb.watch" ||
    /\/(videos?|reel|reels|watch|share\/v|share\/r)\b/.test(path) ||
    url.searchParams.has("v");
  if (isVideo) return { kind: "video", url: url.toString() };
  return { kind: "page", url: `https://www.facebook.com${url.pathname}` };
}

/** Channel login from `twitch.tv/<channel>` or a bare channel name. */
export function twitchChannel(raw: string): string | null {
  const value = raw.trim();
  if (/^[A-Za-z0-9_]{2,25}$/.test(value)) return value.toLowerCase();
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!bareHost(host, "twitch.tv")) return null;
  const first = url.pathname.split("/").filter(Boolean)[0];
  if (!first || ["directory", "videos", "settings", "downloads", "p", "search"].includes(first)) {
    return null;
  }
  return /^[A-Za-z0-9_]{2,25}$/.test(first) ? first.toLowerCase() : null;
}

/* -------------------------------------------------------------------------- */
/* Embed URLs                                                                 */
/* -------------------------------------------------------------------------- */

export type EmbedRatio = "video" | "portrait" | "feed";

export type EmbedResult =
  | { kind: "embed"; url: string; ratio: EmbedRatio }
  | { kind: "needs-link"; hint: string }
  | { kind: "unsupported" };

function twitchParents(): string[] {
  if (typeof window === "undefined") return ["localhost"];
  const parents = new Set<string>(["localhost"]);
  const host = window.location.hostname;
  if (host) parents.add(host);
  try {
    for (const ancestor of Array.from(window.location.ancestorOrigins ?? [])) {
      try {
        const parsed = new URL(ancestor).hostname;
        if (parsed) parents.add(parsed);
      } catch {
        /* ignore malformed ancestor origins */
      }
    }
  } catch {
    /* ancestorOrigins is not available everywhere */
  }
  return [...parents];
}

/**
 * Build the official embed for an app. `input` is whatever the user typed in
 * the link field; pass the app's `defaultInput` for the initial view.
 */
export function buildSocialEmbed(app: SocialApp, input: string): EmbedResult {
  if (!app.embeddable) return { kind: "unsupported" };
  const value = input.trim();

  switch (app.id) {
    case "youtube": {
      const id = youtubeVideoId(value);
      if (!id)
        return { kind: "needs-link", hint: "Paste a YouTube video or Shorts link to embed it." };
      return {
        kind: "embed",
        url: `https://www.youtube.com/embed/${id}?rel=0&playsinline=1&modestbranding=1`,
        ratio: "video",
      };
    }
    case "tiktok": {
      const id = tiktokVideoId(value);
      if (!id) return { kind: "needs-link", hint: "Paste a TikTok video link to embed it." };
      return { kind: "embed", url: `https://www.tiktok.com/embed/v2/${id}`, ratio: "portrait" };
    }
    case "x": {
      const id = tweetId(value);
      if (id) {
        return {
          kind: "embed",
          url: `https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=dark&id=${id}`,
          ratio: "feed",
        };
      }
      const handle = xHandle(value);
      if (!handle) return { kind: "needs-link", hint: "Paste a post link or @handle to embed it." };
      return {
        kind: "embed",
        url: `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}?showReplies=false&theme=dark&lang=en`,
        ratio: "feed",
      };
    }
    case "instagram": {
      const parsed = instagramShortcode(value);
      if (!parsed)
        return { kind: "needs-link", hint: "Paste an Instagram post or reel link to embed it." };
      return {
        kind: "embed",
        url: `https://www.instagram.com/${parsed.kind}/${parsed.code}/embed/captioned/`,
        ratio: "portrait",
      };
    }
    case "facebook": {
      const target = facebookTarget(value);
      if (!target)
        return {
          kind: "needs-link",
          hint: "Paste a Facebook page, video or reel link to embed it.",
        };
      if (target.kind === "video") {
        return {
          kind: "embed",
          url: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
            target.url,
          )}&show_text=false&width=560&height=700`,
          ratio: "portrait",
        };
      }
      return {
        kind: "embed",
        url: `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(
          target.url,
        )}&tabs=timeline&width=500&height=700&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=true`,
        ratio: "feed",
      };
    }
    case "twitch": {
      const channel = twitchChannel(value);
      if (!channel) return { kind: "needs-link", hint: "Paste a Twitch channel link to embed it." };
      const parents = twitchParents()
        .map((p) => `parent=${encodeURIComponent(p)}`)
        .join("&");
      return {
        kind: "embed",
        url: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&${parents}&muted=true`,
        ratio: "video",
      };
    }
    default:
      return { kind: "unsupported" };
  }
}
