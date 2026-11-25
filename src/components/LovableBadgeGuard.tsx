import { useEffect } from "react";

/**
 * Permanently removes the Lovable "Edit with Lovable" badge.
 *
 * The badge is not part of this app's source — Lovable's preview/host injects
 * it into the page at runtime, sometimes after hydration. CSS hides it (see
 * `styles.css`), but a hidden node can still swallow taps or get re-injected,
 * so this guard also deletes the node and keeps watching for re-injection.
 *
 * Scope is deliberately narrow: only the badge element, its class, links that
 * point at lovable, and lovable badge iframes. Nothing else is touched, so
 * ordinary buttons and links keep working.
 */

// Nodes we delete outright. Plain `a[href*="lovable"]` links are only hidden
// by CSS (as requested) so a legitimate link is never destroyed.
const BADGE_SELECTOR = "[data-lovable-badge], .lovable-badge";

/** True when an element is the Lovable badge (or wraps one). */
function isBadge(el: Element): boolean {
  if (el.matches(BADGE_SELECTOR)) return true;

  // Badge iframes/scripts point at a lovable host and are labelled as the
  // editor badge. Only remove ones that are clearly the badge — never the
  // app's own embeds (browser, YouTube, etc.).
  const tag = el.tagName.toLowerCase();
  if (tag === "iframe" || tag === "script") {
    const src = (el.getAttribute("src") || el.getAttribute("data-src") || "").toLowerCase();
    const title = (el.getAttribute("title") || "").toLowerCase();
    const looksLovable = src.includes("lovable");
    const looksBadge = title.includes("edit with lovable") || src.includes("badge");
    if (looksLovable && looksBadge) return true;
  }

  // Fallback: an element whose own text is exactly the badge label.
  const text = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (text === "edit with lovable" && el.children.length <= 2) return true;

  return false;
}

function sweep(root: ParentNode): void {
  try {
    root.querySelectorAll(BADGE_SELECTOR).forEach((el) => el.remove());
    root.querySelectorAll("a, div, span, button, iframe, script").forEach((el) => {
      if (isBadge(el)) el.remove();
    });
  } catch {
    /* ignore — never let badge cleanup break the app */
  }
}

export function LovableBadgeGuard() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    sweep(document);

    // Watch for the badge being injected after load (or re-injected after we
    // remove it). MutationObserver covers refresh, reload, and SPA navigation
    // without any per-page wiring.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            const el = node as Element;
            if (isBadge(el)) {
              el.remove();
              return;
            }
            sweep(el);
          });
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
    };
  }, []);

  return null;
}
