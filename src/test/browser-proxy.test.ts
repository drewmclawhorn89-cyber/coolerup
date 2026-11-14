import { describe, expect, it } from "vitest";
import {
  PROXY_PATH,
  isProxyable,
  proxyErrorPage,
  proxyUrlFor,
  rewriteHtml,
  rewriteNavUrl,
  sanitizeHeaders,
  targetFromProxyUrl,
} from "@/lib/browserProxy";

describe("isProxyable", () => {
  it("accepts http and https", () => {
    expect(isProxyable("https://example.com")).toBe(true);
    expect(isProxyable("http://example.com/a?b=1")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isProxyable("javascript:alert(1)")).toBe(false);
    expect(isProxyable("mailto:a@b.com")).toBe(false);
    expect(isProxyable("about:blank")).toBe(false);
    expect(isProxyable("not a url")).toBe(false);
  });
});

describe("proxyUrlFor / targetFromProxyUrl", () => {
  it("round-trips a target", () => {
    const target = "https://en.wikipedia.org/wiki/Web_browser?x=1&y=2";
    const proxied = proxyUrlFor(target);
    expect(proxied.startsWith(PROXY_PATH)).toBe(true);
    expect(targetFromProxyUrl(proxied)).toBe(target);
  });

  it("prefixes an origin when given one", () => {
    expect(proxyUrlFor("https://example.com", "http://localhost:8099")).toBe(
      `http://localhost:8099${PROXY_PATH}?url=https%3A%2F%2Fexample.com`,
    );
  });

  it("strips trailing slashes from the origin", () => {
    expect(proxyUrlFor("https://example.com", "http://localhost:8099/")).toBe(
      `http://localhost:8099${PROXY_PATH}?url=https%3A%2F%2Fexample.com`,
    );
  });

  it("returns null for non-proxy URLs", () => {
    expect(targetFromProxyUrl("https://example.com")).toBeNull();
    expect(targetFromProxyUrl(`${PROXY_PATH}?url=javascript:alert(1)`)).toBeNull();
    expect(targetFromProxyUrl(`${PROXY_PATH}`)).toBeNull();
  });
});

describe("rewriteNavUrl", () => {
  const base = "https://en.wikipedia.org/wiki/Web_browser";

  it("routes relative links through the proxy", () => {
    expect(rewriteNavUrl("/wiki/Browser_war", base)).toBe(
      `${PROXY_PATH}?url=${encodeURIComponent("https://en.wikipedia.org/wiki/Browser_war")}`,
    );
  });

  it("resolves protocol-relative and absolute links", () => {
    expect(rewriteNavUrl("//example.com/x", base)).toBe(
      `${PROXY_PATH}?url=${encodeURIComponent("https://example.com/x")}`,
    );
    expect(rewriteNavUrl("https://example.com/y", base)).toBe(
      `${PROXY_PATH}?url=${encodeURIComponent("https://example.com/y")}`,
    );
  });

  it("emits absolute proxy URLs when an origin is supplied", () => {
    expect(rewriteNavUrl("/wiki/Browser_war", base, "http://localhost:8099")).toBe(
      `http://localhost:8099${PROXY_PATH}?url=${encodeURIComponent(
        "https://en.wikipedia.org/wiki/Browser_war",
      )}`,
    );
  });

  it("leaves non-navigational links untouched", () => {
    for (const href of ["#top", "mailto:a@b.com", "javascript:void(0)", "tel:+15551234"]) {
      expect(rewriteNavUrl(href, base)).toBe(href);
    }
  });
});

describe("rewriteHtml", () => {
  const html = `<!doctype html><html><head><title>T</title></head><body>
    <a href="/next" target="_blank">Next</a>
    <a href="#anchor">Anchor</a>
    <form action="/search"><input name="q"></form>
    <img src="/logo.png"><script src="/app.js"></script>
  </body></html>`;

  const out = rewriteHtml(html, "https://example.com/page", "http://localhost:8099");

  it("injects exactly one base tag pointing at the real site", () => {
    expect(out.match(/<base\b/gi)).toHaveLength(1);
    expect(out).toContain('<base href="https://example.com/page">');
  });

  it("injects the runtime shim", () => {
    expect(out).toContain("coolerupAddress");
    expect(out).toContain(PROXY_PATH);
  });

  it("rewrites anchors through the proxy and drops target=_blank", () => {
    expect(out).toContain(
      `href="http://localhost:8099${PROXY_PATH}?url=${encodeURIComponent(
        "https://example.com/next",
      )}"`,
    );
    expect(out).not.toContain('target="_blank"');
  });

  it("leaves in-page anchors alone", () => {
    expect(out).toContain('href="#anchor"');
  });

  it("rewrites form actions", () => {
    expect(out).toContain(
      `action="http://localhost:8099${PROXY_PATH}?url=${encodeURIComponent(
        "https://example.com/search",
      )}"`,
    );
  });

  it("does not rewrite subresources", () => {
    expect(out).toContain('src="/logo.png"');
    expect(out).toContain('src="/app.js"');
  });

  it("replaces an existing base tag instead of adding a second one", () => {
    const withBase = rewriteHtml(
      '<html><head><base href="https://evil.test/"></head><body></body></html>',
      "https://example.com/",
    );
    expect(withBase.match(/<base\b/gi)).toHaveLength(1);
    expect(withBase).not.toContain("evil.test");
  });

  it("handles documents without a head", () => {
    const out2 = rewriteHtml("<p>hi</p>", "https://example.com/");
    expect(out2).toContain("<base href=");
    expect(out2).toContain("<p>hi</p>");
  });
});

describe("sanitizeHeaders", () => {
  it("drops frame-blocking and hop-by-hop headers", () => {
    const source = new Headers({
      "content-type": "text/html",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      "content-encoding": "gzip",
      "content-length": "123",
      "set-cookie": "a=b",
      "strict-transport-security": "max-age=1",
      "cross-origin-opener-policy": "same-origin",
    });
    const out = sanitizeHeaders(source);
    expect(out.get("content-type")).toBe("text/html");
    for (const key of [
      "x-frame-options",
      "content-security-policy",
      "content-encoding",
      "content-length",
      "set-cookie",
      "strict-transport-security",
      "cross-origin-opener-policy",
    ]) {
      expect(out.get(key)).toBeNull();
    }
  });

  it("marks the response as coming from Coolerup", () => {
    const out = sanitizeHeaders(new Headers());
    expect(out.get("access-control-allow-origin")).toBe("*");
    expect(out.get("x-coolerup-proxy")).toBe("1");
  });
});

describe("proxyErrorPage", () => {
  it("escapes the message and target", () => {
    const page = proxyErrorPage("<script>alert(1)</script>", "https://x.test/<b>");
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;");
    expect(page).toContain("Coolerup Browser");
  });
});
