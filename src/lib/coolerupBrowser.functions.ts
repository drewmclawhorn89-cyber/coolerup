import { createServerFn } from "@tanstack/react-start";
import type { SearchResponse, SearchResult } from "@/lib/coolerupBrowser";

/**
 * Coolerup Browser search backend.
 *
 * The browser shows Coolerup-branded result cards, so the raw provider markup
 * must never reach the client. This function does the fetching and parsing on
 * the server and returns plain `{ title, url, snippet }` objects.
 *
 * Providers, in order:
 *
 *   1. **Google Custom Search JSON API** — used when `GOOGLE_CSE_KEY` and
 *      `GOOGLE_CSE_CX` are set on the host. Highest quality, fully supported.
 *   2. **DuckDuckGo HTML** — no key needed. Parsed server-side; if DuckDuckGo
 *      serves its anti-bot challenge we fall through.
 *   3. **Wikipedia search API** — always available, so a search never returns
 *      an empty page.
 *
 * Nothing here is authenticated: browsing is public, like a browser should be.
 */

const MAX_QUERY = 200;
const MAX_RESULTS = 12;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));

const stripTags = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/* -------------------------------------------------------------------------- */
/* 1. Google Custom Search                                                    */
/* -------------------------------------------------------------------------- */

type GoogleItem = { title?: string; link?: string; snippet?: string };

async function searchGoogle(query: string, key: string, cx: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    key,
    cx,
    q: query,
    num: String(MAX_RESULTS),
    safe: "active",
  });
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { items?: GoogleItem[] } | null;
  const items = json?.items ?? [];
  return items
    .filter((item): item is GoogleItem & { link: string } => typeof item.link === "string")
    .map((item) => ({
      title: decodeEntities(item.title ?? item.link).slice(0, 200),
      url: item.link,
      snippet: stripTags(item.snippet ?? "").slice(0, 300),
      host: hostOf(item.link),
    }));
}

/* -------------------------------------------------------------------------- */
/* 3. DuckDuckGo HTML                                                         */
/* -------------------------------------------------------------------------- */

/** DuckDuckGo wraps results in `/l/?uddg=<encoded target>`. */
function unwrapDdg(href: string): string | null {
  try {
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    const parsed = new URL(absolute, "https://duckduckgo.com");
    const target = parsed.searchParams.get("uddg");
    if (target) return decodeURIComponent(target);
    if (parsed.hostname.endsWith("duckduckgo.com")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      accept: "text/html",
    },
    body: new URLSearchParams({ q: query, kl: "us-en", kp: "-2" }).toString(),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  if (/anomaly-modal|challenge-form/i.test(html)) return [];

  const results: SearchResult[] = [];
  // Each result: <a class="result__a" href="...">Title</a> ... <a class="result__snippet">…</a>
  const blocks = html.split(/<div class="result results_links[^"]*"/).slice(1);
  for (const block of blocks) {
    const linkMatch = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(
      block,
    );
    if (!linkMatch) continue;
    const url = unwrapDdg(linkMatch[1] ?? "");
    if (!url) continue;
    const title = stripTags(linkMatch[2] ?? "");
    if (!title) continue;
    const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    results.push({
      title: title.slice(0, 200),
      url,
      snippet: stripTags(snippetMatch?.[1] ?? "").slice(0, 300),
      host: hostOf(url),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* 2. Bing                                                                    */
/* -------------------------------------------------------------------------- */

/** Bing wraps every result in `bing.com/ck/a?...&u=a1<base64url>`. */
function unwrapBing(href: string): string {
  const decoded = decodeEntities(href);
  const match = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(decoded);
  if (!match?.[1]) return decoded;
  const raw = match[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return decoded;
  }
}

async function searchBing(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: "20", setlang: "en", cc: "US" });
  const res = await fetch(`https://www.bing.com/search?${params.toString()}`, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return [];
  const html = await res.text();

  const results: SearchResult[] = [];
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  for (const block of blocks) {
    const link = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link?.[1]) continue;
    const url = unwrapBing(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripTags(link[2] ?? "");
    if (!title) continue;
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    results.push({
      title: title.slice(0, 200),
      url,
      snippet: stripTags(snippet?.[1] ?? "").slice(0, 300),
      host: hostOf(url),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* 4. Wikipedia                                                               */
/* -------------------------------------------------------------------------- */

type WikiHit = { title?: string; snippet?: string; pageid?: number };

async function searchWikipedia(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    format: "json",
    srlimit: "8",
    srprop: "snippet",
    origin: "*",
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { query?: { search?: WikiHit[] } } | null;
  const hits = json?.query?.search ?? [];
  return hits
    .filter((hit): hit is WikiHit & { title: string } => typeof hit.title === "string")
    .map((hit) => {
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`;
      return {
        title: hit.title.slice(0, 200),
        url,
        snippet: stripTags(hit.snippet ?? "").slice(0, 300),
        host: "en.wikipedia.org",
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export const searchCoolerupBrowser = createServerFn({ method: "GET" })
  .inputValidator((input: { q?: string } | undefined) => {
    const raw = typeof input?.q === "string" ? input.q : "";
    return { q: raw.trim().slice(0, MAX_QUERY) };
  })
  .handler(async ({ data }): Promise<SearchResponse> => {
    const query = data.q;
    if (!query) return { ok: false, reason: "empty" };

    const key = (
      process.env["GOOGLE_CSE_KEY"] ??
      process.env["GOOGLE_SEARCH_API_KEY"] ??
      ""
    ).trim();
    const cx = (
      process.env["GOOGLE_CSE_CX"] ??
      process.env["GOOGLE_SEARCH_ENGINE_ID"] ??
      ""
    ).trim();

    if (key && cx) {
      try {
        const results = await searchGoogle(query, key, cx);
        if (results.length > 0) return { ok: true, results, source: "google" };
      } catch {
        /* fall through to the next provider */
      }
    }

    // Bing has the widest index reachable without an API key, so it runs
    // before the smaller providers. Together with Google CSE this covers
    // effectively everything a normal Google search would surface.
    try {
      const results = await searchBing(query);
      if (results.length > 0) return { ok: true, results, source: "bing" };
    } catch {
      /* fall through */
    }

    try {
      const results = await searchDuckDuckGo(query);
      if (results.length > 0) return { ok: true, results, source: "duckduckgo" };
    } catch {
      /* fall through */
    }

    try {
      const results = await searchWikipedia(query);
      if (results.length > 0) return { ok: true, results, source: "wikipedia" };
    } catch {
      return { ok: false, reason: "network" };
    }

    return { ok: false, reason: "no-results" };
  });

/* -------------------------------------------------------------------------- */
/* Page proxy                                                                 */
/* -------------------------------------------------------------------------- */

const MAX_PAGE_BYTES = 1_800_000;

export type ProxiedPage =
  | {
      ok: true;
      url: string;
      title: string;
      /**
       * `page` renders the fetched markup. `summary` is used for sites whose
       * HTML is an empty JavaScript shell (TikTok, Instagram): there is
       * nothing to paint, so Coolerup shows the site's own title,
       * description and links instead of a blank rectangle.
       */
      mode: "page" | "summary";
      html: string;
      description: string;
      image: string;
      links: { label: string; url: string }[];
    }
  | { ok: false; reason: "blocked" | "network" | "not-html" };

const metaContent = (html: string, names: string[]): string => {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
      "i",
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      "i",
    );
    const hit = re.exec(html) ?? alt.exec(html);
    if (hit?.[1]) return decodeEntities(hit[1]).slice(0, 400);
  }
  return "";
};

/** Rough "how much is actually on this page" measure. */
const visibleTextLength = (html: string): number =>
  stripTags(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " "),
  ).length;

const stripTagsTitle = (html: string): string => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return stripTags(match?.[1] ?? "").slice(0, 120);
};

/**
 * Some sites (TikTok, Instagram) put their real content in an embedded JSON
 * blob instead of the markup. Pull the human-readable bits out of it so the
 * summary card has a real description, avatar and post links.
 */
function enrichFromEmbeddedJson(html: string): {
  description: string;
  image: string;
  links: { label: string; url: string }[];
} {
  const out = { description: "", image: "", links: [] as { label: string; url: string }[] };
  const blob =
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    )?.[1] ?? "";
  if (!blob) return out;

  const pick = (key: string): string => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const hit = re.exec(blob);
    if (!hit?.[1]) return "";
    try {
      return JSON.parse(`"${hit[1]}"`) as string;
    } catch {
      return hit[1];
    }
  };

  out.description = pick("signature") || pick("description") || pick("bio");
  out.image = pick("avatarLarger") || pick("avatarMedium") || pick("cover");

  // Video ids, so the summary can offer real posts that play in Coolerup.
  const seen = new Set<string>();
  const idRe = /"id"\s*:\s*"(7\d{17,20})"/g;
  let match: RegExpExecArray | null;
  while ((match = idRe.exec(blob)) && out.links.length < 6) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.links.push({
      label: `Video ${out.links.length + 1}`,
      url: `https://www.tiktok.com/embed/v2/${id}`,
    });
  }

  return out;
}

/**
 * A handful of real destinations found on a page, for the summary card.
 * Only same-site links are kept so the list stays on topic.
 */
function summaryLinks(html: string, baseUrl: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && out.length < 8) {
    const href = match[1];
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(decodeEntities(href), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(absolute)) continue;
    const label = stripTags(match[2] ?? "");
    if (label.length < 3 || seen.has(absolute)) continue;
    seen.add(absolute);
    out.push({ label: label.slice(0, 70), url: absolute });
  }
  return out;
}

/**
 * Fetch a page and turn it into something Coolerup can render in an iframe.
 *
 * Some of the biggest sites (TikTok, Instagram, X) send `X-Frame-Options:
 * DENY`, which makes a plain <iframe> show a blank box. Fetching the HTML
 * ourselves and rendering it with `srcDoc` sidesteps that entirely, so the
 * page appears *inside* Coolerup instead of kicking people out to Chrome.
 *
 * Safety: scripts and inline event handlers are removed before the markup is
 * returned, and the iframe is sandboxed without `allow-scripts`, so a proxied
 * page can never run code in the Coolerup origin.
 */
export const fetchBrowserPage = createServerFn({ method: "GET" })
  .inputValidator((input: { url?: string } | undefined) => {
    const raw = typeof input?.url === "string" ? input.url : "";
    return { url: raw.trim().slice(0, 2048) };
  })
  .handler(async ({ data }): Promise<ProxiedPage> => {
    const target = data.url;
    if (!/^https?:\/\//i.test(target)) return { ok: false, reason: "blocked" };

    let res: Response;
    try {
      res = await fetch(target, {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      return { ok: false, reason: "network" };
    }

    if (!res.ok) return { ok: false, reason: "network" };

    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(type)) return { ok: false, reason: "not-html" };

    const raw = (await res.text()).slice(0, MAX_PAGE_BYTES);
    const finalUrl = res.url || target;
    const title =
      metaContent(raw, ["og:title", "twitter:title"]) ||
      stripTagsTitle(raw) ||
      hostOf(finalUrl) ||
      "Coolerup Browser";
    let description = metaContent(raw, ["og:description", "twitter:description", "description"]);
    let image = metaContent(raw, ["og:image", "twitter:image"]);
    const embedded = enrichFromEmbeddedJson(raw);
    if (!description) description = embedded.description;
    if (!image) image = embedded.image;
    const textLength = visibleTextLength(raw);

    // Drop anything that could execute or reframe.
    let html = raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<script\b[^>]*\/>/gi, "")
      .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
      .replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "")
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
      .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "");

    // Everything relative now resolves against the real page.
    const base = `<base href="${finalUrl.replace(/"/g, "&quot;")}">`;
    const style = `<style>
      :root { color-scheme: light; }
      html, body { background: #fff !important; }
      body { margin: 0; padding: 14px 14px 40px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #111; overflow-x: hidden; }
      img, video { max-width: 100% !important; height: auto !important; }
      table { max-width: 100%; }
      a { color: #2563EB; }
      * { max-width: 100%; }
    </style>`;

    // Send link taps up to the Coolerup chrome so navigation stays in-app.
    const navScript = `<script>
      document.addEventListener("click", function (event) {
        var node = event.target;
        while (node && node.tagName !== "A") node = node.parentElement;
        if (!node || !node.href) return;
        event.preventDefault();
        parent.postMessage({ coolerupNavigate: node.href }, "*");
      }, true);
    </script>`;

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}${base}${style}`);
    } else {
      html = `${base}${style}${html}`;
    }

    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${navScript}</body>`);
    else html = `${html}${navScript}`;

    /* A JavaScript shell (TikTok, Instagram) has almost no readable markup.
       Painting it would show an empty box, so switch to the summary card. */
    const mode: "page" | "summary" = textLength < 400 ? "summary" : "page";

    if (mode === "summary") {
      return {
        ok: true,
        url: finalUrl,
        title,
        mode,
        html: "",
        description,
        image: /^https?:\/\//i.test(image) ? image : "",
        links: [...embedded.links, ...summaryLinks(raw, finalUrl)].slice(0, 8),
      };
    }

    return { ok: true, url: finalUrl, title, mode, html, description, image: "", links: [] };
  });
