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
export function isProxyable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
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
      // Already one of ours (an anchor we rewrote) \u2014 never wrap twice.
      try { if (isProxyUrl(new URL(a))) return a; } catch(e){}
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

  // --- Keep Coolerup's own storage out of reach of proxied sites -----------
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
    ["pushState", "replaceState"].forEach(function(k){
      var orig = history[k];
      if (!orig) return;
      history[k] = function(state, title, url){
        var real = url == null ? null : target(url);
        try {
          if (url != null) {
            var t = new URL(real);
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

  // --- Forms: send GET forms through the proxy too --------------------------
  safe(function(){
    document.addEventListener("submit", function(ev){
      var form = ev.target;
      if (!form || form.tagName !== "FORM") return;
      var method = (form.getAttribute("method") || "get").toLowerCase();
      if (method !== "get") return;
      try {
        var action = form.getAttribute("action") || location.href;
        var t = prox(action);
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

  // Drop any existing base tag so ours is the only one.
  out = out.replace(/<base\b[^>]*>/gi, "");

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
