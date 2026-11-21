/**
 * Coolerup Browser — reverse proxy helpers.
 *
 * Why a proxy at all?
 * -------------------
 * A normal `<iframe src="https://site.com">` is refused by most sites: they send
 * `X-Frame-Options: DENY` or a CSP `frame-ancestors` rule, and the browser shows
 * a blank rectangle. That is the single reason "some sites don't load".
 *
 * So Coolerup fetches the page itself, strips only the *frame-blocking* headers,
 * and serves it back from our own origin. The page's own JavaScript is left
 * untouched, which is what makes real web apps (React/Vue/Angular SPAs) work
 * instead of degrading to a text summary.
 *
 * The pieces here are deliberately pure so they can be unit tested:
 *
 *   - `rewriteHtml`  — injects a base tag + the runtime shim, and rewrites the
 *                      navigational URLs (`a href`, `form action`) so links keep
 *                      opening inside Coolerup instead of escaping.
 *   - `PROXY_SHIM`   — a tiny runtime that routes `fetch`, `XMLHttpRequest`,
 *                      `history.pushState/replaceState` and `location` changes
 *                      back through the proxy, so SPAs can talk to their API.
 */

/** Path of the server endpoint that does the actual fetching. */
export const PROXY_PATH = "/api/browser/proxy";

/** Only real web pages can be proxied. */
/** Blocks loopback, private, link-local and metadata hosts so the proxy can't reach internal services. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    !h ||
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  )
    return true;
  if (h === "metadata.google.internal") return true;
  if (h.includes(":")) {
    return (
      h === "::" ||
      h === "::1" ||
      h.startsWith("fc") ||
      h.startsWith("fd") ||
      h.startsWith("fe80") ||
      h.startsWith("::ffff:")
    );
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return true;
  return false;
}

export function isProxyable(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    return !isPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Wrap a target URL in the Coolerup proxy URL.
 *
 * `origin` should be passed whenever the result is embedded in a proxied page,
 * because those pages carry a base tag pointing at the real site. A
 * root-relative `/api/browser/proxy?...` would resolve against *that* base and
 * escape to the real site; an absolute URL is immune to the base tag.
 */
export function proxyUrlFor(target: string, origin?: string): string {
  const path = `${PROXY_PATH}?url=${encodeURIComponent(target)}`;
  return origin ? `${origin.replace(/\/+$/, "")}${path}` : path;
}

/** Pull the target back out of a proxy URL (or null if it isn't one). */
export function targetFromProxyUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "https://coolerup.local");
    if (parsed.pathname !== PROXY_PATH) return null;
    const target = parsed.searchParams.get("url");
    return target && isProxyable(target) ? target : null;
  } catch {
    return null;
  }
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NON_NAV = /^(#|javascript:|mailto:|tel:|data:|blob:|about:|sms:|whatsapp:)/i;

/**
 * Resolve a link found in the page and route it through the proxy.
 * Anything that isn't a normal web navigation is left exactly as it was.
 */
export function rewriteNavUrl(href: string, baseUrl: string, origin?: string): string {
  const trimmed = href.trim();
  if (!trimmed || NON_NAV.test(trimmed)) return href;
  let absolute: string;
  try {
    absolute = new URL(trimmed, baseUrl).href;
  } catch {
    return href;
  }
  if (!isProxyable(absolute)) return href;
  return proxyUrlFor(absolute, origin);
}

/**
 * The runtime injected into every proxied page.
 *
 * It is intentionally defensive: every patch is wrapped so a site that has
 * frozen a built-in cannot break the whole page, and the storage shim keeps a
 * proxied site from reading Coolerup's own Supabase session out of
 * `localStorage` (the proxy is served from our origin, so without this a
 * hostile page could read our keys).
 */
export const PROXY_SHIM = `<script>(function(){
  var BASE = document.baseURI || location.href;
  var PROXY = "${PROXY_PATH}";
  function abs(u){ try { return new URL(u, BASE).href; } catch(e){ return u; } }
  function isProxyUrl(p){ try { return p.origin === location.origin && p.pathname === PROXY; } catch(e){ return false; } }
  function prox(u){
    try {
      if (u == null) return u;
      var a = abs(String(u));
      if (!/^https?:/i.test(a)) return u;
      var parsed = new URL(a);
      // Already one of ours (an anchor we rewrote) \u2014 never wrap twice.
      if (isProxyUrl(parsed)) return a;
      // If a page script built an absolute URL using window.location.origin,
      // point it back at the real upstream origin before proxying.
      if (parsed.origin === location.origin) {
        var baseOrigin = new URL(BASE).origin;
        a = baseOrigin + parsed.pathname + parsed.search + parsed.hash;
      }
      // Absolute on purpose: this document has a base tag pointing at the real
      // site, so a root-relative proxy path would resolve to the wrong host.
      return location.origin + PROXY + "?url=" + encodeURIComponent(a);
    } catch(e){ return u; }
  }
  // The real site URL behind any URL we might be handed.
  function target(u){
    try {
      var p = new URL(abs(String(u)));
      if (isProxyUrl(p)) {
        var t = p.searchParams.get("url");
        if (t) return t;
      }
      return p.href;
    } catch(e){ return String(u); }
  }
  function tell(url){
    try { if (parent !== window) parent.postMessage({ coolerupAddress: url }, "*"); } catch(e){}
  }
  function safe(fn){ try { fn(); } catch(e){} }

  // --- Keep Coolerup's own storage & cookies out of reach of proxied sites -
  safe(function(){
    var mem = {};
    var fake = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function(k, v){ mem[k] = String(v); },
      removeItem: function(k){ delete mem[k]; },
      clear: function(){ mem = {}; },
      key: function(i){ return Object.keys(mem)[i] || null; },
      get length(){ return Object.keys(mem).length; }
    };
    try { Object.defineProperty(window, "localStorage", { value: fake, configurable: true }); } catch(e){}
    try { Object.defineProperty(window, "sessionStorage", { value: fake, configurable: true }); } catch(e){}
    var cookieJar = {};
    try {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: function(){
          return Object.keys(cookieJar).map(function(k){ return k + "=" + cookieJar[k]; }).join("; ");
        },
        set: function(raw){
          var pair = String(raw || "").split(";")[0];
          var eq = pair.indexOf("=");
          if (eq <= 0) return;
          var name = pair.slice(0, eq).trim();
          var val = pair.slice(eq + 1).trim();
          if (!name) return;
          if (/max-age\\s*=\\s*0/i.test(raw)) delete cookieJar[name];
          else cookieJar[name] = val;
        }
      });
    } catch(e){}
  });

  // --- fetch ---------------------------------------------------------------
  safe(function(){
    var f = window.fetch;
    if (!f) return;
    window.fetch = function(input, init){
      try {
        if (typeof input === "string") input = prox(input);
        else if (input && input.url) input = new Request(prox(input.url), input);
      } catch(e){}
      return f.call(this, input, init);
    };
  });

  // --- sendBeacon ----------------------------------------------------------
  safe(function(){
    if (!navigator || typeof navigator.sendBeacon !== "function") return;
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data){
      try { return origBeacon(prox(url), data); } catch(e){ return true; }
    };
  });

  // --- XMLHttpRequest ------------------------------------------------------
  safe(function(){
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url){
      try { arguments[1] = prox(url); } catch(e){}
      return open.apply(this, arguments);
    };
  });

  // --- history -------------------------------------------------------------
  // SPAs call pushState("/learn"). That would resolve against the base tag (the
  // real site) and throw, so we keep the *path* but pin it to our own origin.
  // The page still sees /learn, back/forward still work, and the Coolerup
  // address bar is told the real target so it stays honest.
  safe(function(){
    var origReplace = history.replaceState;
    try {
      var locParsed = new URL(location.href);
      if (isProxyUrl(locParsed)) {
        var realInit = locParsed.searchParams.get("url");
        if (realInit) {
          var initUrl = new URL(realInit);
          BASE = initUrl.href;
          if (origReplace) {
            origReplace.call(history, history.state, "", location.origin + initUrl.pathname + initUrl.search + initUrl.hash);
          }
          tell(initUrl.href);
        }
      }
    } catch(e){}

    ["pushState", "replaceState"].forEach(function(k){
      var orig = history[k];
      if (!orig) return;
      history[k] = function(state, title, url){
        var real = url == null ? null : target(url);
        try {
          if (url != null) {
            var t = new URL(real);
            if (/^https?:/i.test(t.protocol)) BASE = t.href;
            arguments[2] = location.origin + t.pathname + t.search + t.hash;
          }
        } catch(e){}
        var out = orig.apply(this, arguments);
        if (real) tell(real);
        return out;
      };
    });
  });

  // --- back/forward: keep the address bar in sync ---------------------------
  safe(function(){
    window.addEventListener("popstate", function(){
      try { tell(target(location.href)); } catch(e){}
    });
  });

  // --- location.assign / replace -------------------------------------------
  safe(function(){
    ["assign", "replace"].forEach(function(k){
      var orig = location[k];
      if (typeof orig !== "function") return;
      try {
        location[k] = function(url){ return orig.call(location, prox(url)); };
      } catch(e){}
    });
  });

  // --- window.open ---------------------------------------------------------
  safe(function(){
    var o = window.open;
    if (typeof o !== "function") return;
    window.open = function(url){
      try { arguments[0] = prox(url); } catch(e){}
      return o.apply(window, arguments);
    };
  });

  // --- Dynamic links: keep JS-rendered <a> navigations inside Coolerup -----
  safe(function(){
    document.addEventListener("click", function(ev){
      if (ev.defaultPrevented) return;
      var node = ev.target;
      var anchor = node && node.closest ? node.closest("a[href]") : null;
      if (!anchor) return;
      var rawHref = anchor.getAttribute("href") || "";
      if (!rawHref || /^(#|javascript:|mailto:|tel:|data:|blob:|about:|sms:|whatsapp:)/i.test(rawHref.trim())) return;
      try {
        var resolved = new URL(rawHref, BASE);
        if (!/^https?:/i.test(resolved.protocol)) return;
        if (isProxyUrl(resolved)) return;
        ev.preventDefault();
        anchor.removeAttribute("target");
        location.href = prox(resolved.href);
      } catch(e){}
    }, false);
  });

  // --- Forms: send GET and POST forms through the proxy too ----------------
  safe(function(){
    document.addEventListener("submit", function(ev){
      var form = ev.target;
      if (!form || form.tagName !== "FORM") return;
      var method = (form.getAttribute("method") || "get").toLowerCase();
      var rawAction = form.getAttribute("action") || target(location.href);
      if (method !== "get") {
        try {
          var nextAction = prox(rawAction);
          if (nextAction) form.setAttribute("action", nextAction);
        } catch(e){}
        return;
      }
      try {
        var t = prox(rawAction);
        var params = new URLSearchParams(new FormData(form)).toString();
        ev.preventDefault();
        location.href = t + (t.indexOf("?") >= 0 ? "&" : "?") + params;
      } catch(e){}
    }, true);
  });
})();</script>`;

/** Strip attributes that would let a link escape the in-app browser. */
function stripTargetBlank(tag: string): string {
  return tag
    .replace(/\s+target\s*=\s*(["'])_blank\1/gi, "")
    .replace(/\s+target\s*=\s*_blank\b/gi, "");
}

/**
 * Rewrite a proxied HTML document.
 *
 * We do **not** rewrite subresources (scripts, styles, images). A base tag
 * makes every relative URL resolve against the real site, so assets load from
 * the origin — they are not subject to frame-blocking, and rewriting them would
 * break integrity hashes and CORS. Only navigations need to come back to us.
 */
export function rewriteHtml(html: string, baseUrl: string, origin?: string): string {
  let out = html;

  // Drop any existing base tag or meta CSP so ours is the only policy.
  out = out.replace(/<base\b[^>]*>/gi, "");
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");

  const inject = `<base href="${escapeAttr(baseUrl)}">${PROXY_SHIM}`;
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (m) => `${m}${inject}`);
  } else if (/<html\b[^>]*>/i.test(out)) {
    out = out.replace(/<html\b[^>]*>/i, (m) => `${m}<head>${inject}</head>`);
  } else {
    out = inject + out;
  }

  // <a href="...">  →  proxy URL
  out = out.replace(/<a\b[^>]*>/gi, (tag) =>
    stripTargetBlank(tag).replace(
      /(\bhref\s*=\s*)(["'])(.*?)\2/i,
      (_m, pre: string, quote: string, href: string) =>
        `${pre}${quote}${rewriteNavUrl(href, baseUrl, origin)}${quote}`,
    ),
  );

  // <form action="...">  →  proxy URL
  out = out.replace(/<form\b[^>]*>/gi, (tag) =>
    tag.replace(
      /(\baction\s*=\s*)(["'])(.*?)\2/i,
      (_m, pre: string, quote: string, action: string) =>
        `${pre}${quote}${rewriteNavUrl(action, baseUrl, origin)}${quote}`,
    ),
  );

  return out;
}

/** Response headers that must never be forwarded to the in-app browser. */
const DROP_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
  "strict-transport-security",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

/** Copy a site's headers, dropping the ones that would block or corrupt us. */
export function sanitizeHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!DROP_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("access-control-allow-origin", "*");
  headers.set("x-coolerup-proxy", "1");
  return headers;
}

/** A friendly, Coolerup-branded error page instead of a raw stack trace. */
export function proxyErrorPage(message: string, target: string): string {
  const safeMessage = escapeAttr(message);
  const safeTarget = escapeAttr(target);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coolerup Browser</title>
<style>
  html,body{margin:0;height:100%;background:#0b1220;color:#fff;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:12px;padding:24px;text-align:center}
  .badge{font-size:34px}
  h1{font-size:15px;margin:0;font-weight:800}
  p{margin:0;max-width:340px;font-size:12px;line-height:1.6;color:rgba(255,255,255,.55)}
  code{font-size:11px;color:rgba(255,255,255,.4);word-break:break-all}
  a{margin-top:6px;background:#2563EB;color:#fff;text-decoration:none;
    padding:8px 16px;border-radius:999px;font-size:12px;font-weight:700}
</style></head><body><div class="wrap">
  <div class="badge">🌐</div>
  <h1>Coolerup Browser couldn't load this page</h1>
  <p>${safeMessage}</p>
  <code>${safeTarget}</code>
  <a href="${safeTarget}" target="_blank" rel="noreferrer">Open the site directly</a>
</div></body></html>`;
}
