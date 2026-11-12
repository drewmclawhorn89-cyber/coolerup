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
/* 2. DuckDuckGo HTML                                                         */
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
/* 3. Wikipedia                                                               */
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
