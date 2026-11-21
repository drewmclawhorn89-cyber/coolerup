import { createFileRoute } from "@tanstack/react-router";
import {
  isProxyable,
  proxyErrorPage,
  proxyUrlFor,
  rewriteHtml,
  sanitizeHeaders,
} from "@/lib/browserProxy";
import {
  isFacebookFamilyHost,
  isMobilePreferredHost,
  proxyCookieJar,
  readRequestCookie,
  readSetCookieHeaders,
} from "@/lib/proxyCookies";

/**
 * Coolerup Browser reverse proxy.
 *
 * Fetches a page server-side, drops the headers that stop it being framed, and
 * streams it back from our own origin. HTML is rewritten so links keep opening
 * inside Coolerup; everything else (JS, CSS, images, fonts, video) streams
 * through untouched so real web apps keep working.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const TIMEOUT_MS = 20_000;
const SID_COOKIE = "coolerup_proxy_sid";

const errorResponse = (message: string, target: string, status = 502) =>
  new Response(proxyErrorPage(message, target), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

async function handle(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target || !isProxyable(target)) {
    return errorResponse(
      "That doesn't look like a web address Coolerup can open.",
      target ?? "",
      400,
    );
  }

  const targetUrl = new URL(target);
  const isFb = isFacebookFamilyHost(targetUrl.hostname);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !isFb) {
    return errorResponse("Coolerup Browser can only open pages, not submit data.", target, 405);
  }

  const existingSid = readRequestCookie(request.headers.get("cookie"), SID_COOKIE);
  const sid = existingSid ?? crypto.randomUUID();
  const isNewSid = !existingSid;

  const outbound = new Headers();
  outbound.set("user-agent", isMobilePreferredHost(targetUrl.hostname) ? MOBILE_UA : DESKTOP_UA);
  outbound.set("accept", request.headers.get("accept") ?? "text/html,*/*;q=0.8");
  outbound.set("accept-language", request.headers.get("accept-language") ?? "en-US,en;q=0.9");
  outbound.set("accept-encoding", "identity");

  const contentType = request.headers.get("content-type");
  if (contentType) outbound.set("content-type", contentType);
  const range = request.headers.get("range");
  if (range) outbound.set("range", range);

  if (isFb) {
    outbound.set("referer", `${targetUrl.origin}/`);
    if (method !== "GET" && method !== "HEAD") {
      outbound.set("origin", targetUrl.origin);
    }
    for (const [key, value] of request.headers.entries()) {
      const lower = key.toLowerCase();
      if (lower.startsWith("x-fb-") || lower === "x-asbd-id" || lower === "x-requested-with") {
        outbound.set(lower, value);
      }
    }
  }

  const cookieHeader = proxyCookieJar.getCookieHeader(sid, targetUrl);
  if (cookieHeader) {
    outbound.set("cookie", cookieHeader);
  }

  let body: ArrayBuffer | null = null;
  if (method !== "GET" && method !== "HEAD") {
    body = (await request.arrayBuffer().catch(() => null)) ?? null;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: outbound,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.name + error.message);
    return errorResponse(
      timedOut
        ? "The site took too long to answer. Try again in a moment."
        : "Coolerup couldn't reach that site. Check the address and try again.",
      target,
    );
  }

  const setCookies = readSetCookieHeaders(upstream.headers);
  if (setCookies.length > 0) {
    proxyCookieJar.setFromHeaders(sid, targetUrl, setCookies);
  }

  const headers = sanitizeHeaders(upstream.headers);
  if (isNewSid) {
    headers.append(
      "set-cookie",
      `${SID_COOKIE}=${sid}; Path=/api/browser/proxy; HttpOnly; SameSite=Lax`,
    );
  }

  // Redirects: keep the browser inside the proxy.
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location");
    if (location) {
      let next: string;
      try {
        next = new URL(location, target).href;
      } catch {
        next = location;
      }
      headers.set("location", isProxyable(next) ? proxyUrlFor(next) : next);
    }
    headers.set("cache-control", "no-store");
    return new Response(null, { status: upstream.status, headers });
  }

  const type = upstream.headers.get("content-type") ?? "";

  if (/text\/html|application\/xhtml\+xml/i.test(type)) {
    const html = await upstream.text().catch(() => "");
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(rewriteHtml(html, target, requestUrl.origin), {
      status: upstream.status,
      headers,
    });
  }

  // Everything else (CSS, JS, images, fonts, JSON, video) streams straight through.
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const Route = createFileRoute("/api/browser/proxy")({
  server: {
    handlers: {
      ANY: ({ request }) => handle(request),
    },
  },
});
