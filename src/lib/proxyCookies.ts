/**
 * Lightweight per-session server-side cookie jar for Coolerup's in-app proxy.
 *
 * Proxied sites (especially Facebook) rely on HTTP cookies (`datr`, `sb`,
 * `c_user`, `xs`, `fr`) for login and navigation. Forwarding raw `Set-Cookie`
 * headers to the browser would fail (domain mismatch) or risk colliding with
 * Coolerup's own cookies, so cookies stay isolated per proxy session on the
 * server and are scoped strictly by target host and path.
 */

export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  expiresAt: number | null;
};

const MAX_SESSIONS = 300;
const MAX_COOKIES_PER_SESSION = 150;

export function isMobilePreferredHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "m.facebook.com" ||
    host === "mbasic.facebook.com" ||
    host === "touch.facebook.com" ||
    host === "m.instagram.com"
  );
}

export function isFacebookFamilyHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fb.com" ||
    host.endsWith(".fb.com") ||
    host === "fb.watch" ||
    host.endsWith(".fb.watch") ||
    host === "messenger.com" ||
    host.endsWith(".messenger.com")
  );
}

function defaultPathFor(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const idx = pathname.lastIndexOf("/");
  if (idx <= 0) return "/";
  return pathname.slice(0, idx);
}

function domainMatches(requestHost: string, cookieDomain: string, hostOnly: boolean): boolean {
  const req = requestHost.toLowerCase();
  const dom = cookieDomain.toLowerCase();
  if (hostOnly) return req === dom;
  return req === dom || req.endsWith(`.${dom}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith("/")) return true;
  return requestPath.charAt(cookiePath.length) === "/";
}

/** Validate that the target host is permitted to set a cookie for `cookieDomain`. */
function isPermittedCookieDomain(targetHost: string, cookieDomain: string): boolean {
  const target = targetHost.toLowerCase();
  const dom = cookieDomain.toLowerCase().replace(/^\.+/, "");
  if (!dom || !dom.includes(".")) return false;
  return target === dom || target.endsWith(`.${dom}`);
}

export function parseSetCookie(raw: string, targetUrl: URL): StoredCookie | null {
  const parts = raw.split(";").map((p) => p.trim());
  const first = parts.shift();
  if (!first) return null;
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  let domain = targetUrl.hostname.toLowerCase();
  let hostOnly = true;
  let path = defaultPathFor(targetUrl.pathname);
  let expiresAt: number | null = null;

  for (const attr of parts) {
    if (!attr) continue;
    const sep = attr.indexOf("=");
    const key = (sep === -1 ? attr : attr.slice(0, sep)).trim().toLowerCase();
    const val = sep === -1 ? "" : attr.slice(sep + 1).trim();

    if (key === "domain" && val) {
      const cleaned = val.toLowerCase().replace(/^\.+/, "");
      if (!isPermittedCookieDomain(targetUrl.hostname, cleaned)) return null;
      domain = cleaned;
      hostOnly = false;
    } else if (key === "path" && val.startsWith("/")) {
      path = val;
    } else if (key === "max-age" && val) {
      const secs = Number(val);
      if (Number.isFinite(secs)) {
        expiresAt = secs <= 0 ? 0 : Date.now() + secs * 1000;
      }
    } else if (key === "expires" && val && expiresAt === null) {
      const ms = Date.parse(val);
      if (Number.isFinite(ms)) expiresAt = ms;
    }
  }

  return { name, value, domain, hostOnly, path, expiresAt };
}

/** Extract Set-Cookie header lines from standard Headers (Node 20+ or fallback). */
export function readSetCookieHeaders(headers: Headers): string[] {
  const typed = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof typed.getSetCookie === "function") {
    return typed.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

/** Parse a specific cookie value from an incoming `Cookie` request header. */
export function readRequestCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export class ProxyCookieJar {
  private sessions = new Map<string, Map<string, StoredCookie>>();

  private touchSession(sessionId: string): Map<string, StoredCookie> {
    let jar = this.sessions.get(sessionId);
    if (jar) {
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, jar);
      return jar;
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }
    jar = new Map();
    this.sessions.set(sessionId, jar);
    return jar;
  }

  setFromHeaders(sessionId: string, targetUrl: URL, setCookieHeaders: string[]): void {
    if (!sessionId || setCookieHeaders.length === 0) return;
    const jar = this.touchSession(sessionId);
    const now = Date.now();
    for (const raw of setCookieHeaders) {
      const parsed = parseSetCookie(raw, targetUrl);
      if (!parsed) continue;
      const key = `${parsed.domain}|${parsed.path}|${parsed.name}`;
      if (
        parsed.value === "" ||
        parsed.value.toLowerCase() === "deleted" ||
        (parsed.expiresAt !== null && parsed.expiresAt <= now)
      ) {
        jar.delete(key);
        continue;
      }
      if (!jar.has(key) && jar.size >= MAX_COOKIES_PER_SESSION) {
        const oldestKey = jar.keys().next().value;
        if (oldestKey) jar.delete(oldestKey);
      }
      jar.delete(key);
      jar.set(key, parsed);
    }
  }

  getCookieHeader(sessionId: string, targetUrl: URL): string | null {
    const jar = this.sessions.get(sessionId);
    if (!jar || jar.size === 0) return null;
    const now = Date.now();
    const matched: StoredCookie[] = [];

    for (const [key, cookie] of jar.entries()) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        jar.delete(key);
        continue;
      }
      if (!domainMatches(targetUrl.hostname, cookie.domain, cookie.hostOnly)) continue;
      if (!pathMatches(targetUrl.pathname || "/", cookie.path)) continue;
      matched.push(cookie);
    }

    if (matched.length === 0) return null;
    // More specific paths first per RFC 6265.
    matched.sort((a, b) => b.path.length - a.path.length);
    return matched.map((c) => `${c.name}=${c.value}`).join("; ");
  }
}

export const proxyCookieJar = new ProxyCookieJar();
