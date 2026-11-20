import { createFileRoute } from "@tanstack/react-router";
import {
  extractFacebookCanonical,
  needsFacebookResolve,
  normalizeFacebookVideoUrl,
  unwrapFacebookLoginRedirect,
} from "@/lib/facebook";

/**
 * Turns a Facebook share / fb.watch short link into the real video link so the
 * official player can embed it. Only follows redirects between Facebook hosts and
 * never reads or stores any video bytes.
 */
async function resolveFacebookLink(start: string): Promise<string> {
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    const safe = normalizeFacebookVideoUrl(current);
    if (!safe) return start;
    const res = await fetch(safe, {
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; CoolerupLinkResolver/1.0)", accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = unwrapFacebookLoginRedirect(new URL(location, safe).toString());
      if (next === current) return current;
      current = next;
      if (!needsFacebookResolve(current)) return normalizeFacebookVideoUrl(current) ?? start;
      continue;
    }
    if (res.ok) {
      const canonical = extractFacebookCanonical((await res.text()).slice(0, 300_000));
      const clean = canonical ? normalizeFacebookVideoUrl(canonical) : null;
      if (clean && !needsFacebookResolve(clean)) return clean;
    }
    return normalizeFacebookVideoUrl(current) ?? start;
  }
  return start;
}

export const Route = createFileRoute("/api/facebook/resolve")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const input = new URL(request.url).searchParams.get("url") ?? "";
        const url = normalizeFacebookVideoUrl(input);
        if (!url) return Response.json({ error: "Not a Facebook link" }, { status: 400 });
        if (!needsFacebookResolve(url)) return Response.json({ url });
        try {
          return Response.json({ url: await resolveFacebookLink(url) }, { headers: { "cache-control": "no-store" } });
        } catch {
          return Response.json({ url });
        }
      },
    },
  },
});
