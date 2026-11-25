import { useEffect } from "react";

/**
 * Permanently removes the entire Lovable "Edit with Lovable" badge from the DOM.
 *
 * Lovable's host/CDN injects the badge at runtime (often after load/hydration)
 * as a floating container in the bottom-right corner holding an "Edit with
 * Lovable" link/button plus an X close button, or via an injected script/iframe.
 * Deleting only the inner link leaves the floating wrapper and X close button
 * covering the mobile Profile tab. This guard deletes the whole wrapper
 * container, the badge button, the X close button, and any badge scripts/iframes.
 *
 * Scope is strictly limited to the Lovable editor badge — ordinary app buttons,
 * navigation tabs, and `coolerup.lovable.app` links are never touched.
 */

const BADGE_SELECTOR = [
  "[data-lovable-badge]",
  "[data-lovable-badge-close]",
  "#lovable-badge",
  "#lovable-badge-close",
  "#lovable-badge-wrapper",
  ".lovable-badge",
  "[id*='lovable-badge' i]",
  "[class*='lovable-badge' i]",
  "[id*='edit-with-lovable' i]",
  "[class*='edit-with-lovable' i]",
  "[aria-label*='edit with lovable' i]",
].join(", ");

const SAFE_ANCESTORS = new Set(["HTML", "BODY", "MAIN", "NAV", "HEADER", "FOOTER"]);

function attrText(el: Element): string {
  return [
    el.id,
    typeof el.className === "string" ? el.className : "",
    el.getAttribute("aria-label") || "",
    el.getAttribute("title") || "",
    el.getAttribute("data-testid") || "",
  ]
    .join(" ")
    .toLowerCase();
}

function isLovableEditorUrl(raw: string | null): boolean {
  if (!raw) return false;
  const val = raw.toLowerCase();
  return (
    val.includes("lovable.dev") ||
    val.includes("gptengineer.app") ||
    (val.includes("lovable") && val.includes("badge"))
  );
}

function isUnsafeContainer(el: Element): boolean {
  if (SAFE_ANCESTORS.has(el.tagName)) return true;
  if (el.id === "root" || el.id === "__next" || el.id === "app") return true;
  // Never delete a container holding real app structure.
  if (el.querySelector("nav, main, video, audio, form")) return true;
  return false;
}

/** True when an element is the Lovable badge, its X close button, or its script/iframe. */
function isBadgeElement(el: Element): boolean {
  if (el.matches(BADGE_SELECTOR)) return true;

  const tag = el.tagName.toLowerCase();
  if (tag === "iframe" || tag === "script") {
    const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
    const title = (el.getAttribute("title") || "").toLowerCase();
    const id = (el.id || "").toLowerCase();
    if (isLovableEditorUrl(src)) {
      if (tag === "iframe") return true;
      if (
        src.toLowerCase().includes("badge") ||
        id.includes("badge") ||
        title.includes("lovable")
      ) {
        return true;
      }
    }
    if (title.includes("edit with lovable") || id.includes("lovable-badge")) return true;
    return false;
  }

  if (tag === "a" && isLovableEditorUrl(el.getAttribute("href"))) {
    return true;
  }

  // Fallback: a small element whose visible text is the badge label (with or without ×/Close).
  const text = (el.textContent || "")
    .replace(/\s+/g, " ")
    .replace(/[×✕x]/gi, " ")
    .trim()
    .toLowerCase();
  if (
    (text === "edit with lovable" || text === "edit in lovable" || text === "made with lovable") &&
    !isUnsafeContainer(el) &&
    el.querySelectorAll("*").length <= 12
  ) {
    return true;
  }

  // Open shadow root hosting the badge (some hosts inject via custom element + shadow DOM).
  const shadow = (el as HTMLElement).shadowRoot;
  if (shadow) {
    const shadowText = (shadow.textContent || "").toLowerCase();
    if (
      shadow.querySelector(BADGE_SELECTOR) ||
      shadow.querySelector("a[href*='lovable.dev']") ||
      shadowText.includes("edit with lovable")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Walk up from a matched badge link/text node to the outer floating wrapper
 * container so that sibling close ("X") buttons and wrapper divs are removed too.
 */
function findRemovableTarget(el: Element): Element {
  let target: Element = el;
  let parent = target.parentElement;

  while (parent && !isUnsafeContainer(parent)) {
    const parentInfo = attrText(parent);
    const parentText = (parent.textContent || "").replace(/\s+/g, " ").trim();
    const hasBadgeHint =
      parentInfo.includes("lovable") ||
      parentInfo.includes("edit-with-lovable") ||
      parent.matches(BADGE_SELECTOR);

    let isFixedFloating = false;
    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      try {
        const style = window.getComputedStyle(parent);
        isFixedFloating = style.position === "fixed";
      } catch {
        /* ignore */
      }
    }
    const inlineStyle = (parent.getAttribute("style") || "").toLowerCase();
    if (inlineStyle.includes("position: fixed") || inlineStyle.includes("position:fixed")) {
      isFixedFloating = true;
    }

    // Only climb into a wrapper if it is clearly a small badge container (with optional X button).
    const looksSmallWrapper = parentText.length <= 80 && parent.querySelectorAll("*").length <= 20;

    if ((hasBadgeHint || isFixedFloating) && looksSmallWrapper) {
      target = parent;
      parent = target.parentElement;
      continue;
    }

    // Also absorb an immediate non-app wrapper div whose only extra child is a close button.
    const children = Array.from(parent.children);
    const onlyBadgeAndClose =
      looksSmallWrapper &&
      children.length <= 3 &&
      children.every(
        (child) =>
          child === target ||
          child.tagName === "BUTTON" ||
          child.tagName === "SVG" ||
          isBadgeElement(child),
      );
    if (onlyBadgeAndClose) {
      target = parent;
      parent = target.parentElement;
      continue;
    }

    break;
  }

  return target;
}

function sweepLovableBadge(root: ParentNode = document): void {
  try {
    root.querySelectorAll(BADGE_SELECTOR).forEach((el) => {
      if (!el.isConnected) return;
      findRemovableTarget(el).remove();
    });

    root.querySelectorAll("a, div, aside, span, button, iframe, script").forEach((el) => {
      if (!el.isConnected) return;
      if (isBadgeElement(el)) {
        findRemovableTarget(el).remove();
      }
    });
  } catch {
    /* ignore — never let badge cleanup break the app */
  }
}

export function LovableBadgeGuard() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    sweepLovableBadge(document);

    // Re-sweep briefly after hydration in case a host script injects the badge post-load.
    const t1 = window.setTimeout(() => sweepLovableBadge(document), 100);
    const t2 = window.setTimeout(() => sweepLovableBadge(document), 600);
    const t3 = window.setTimeout(() => sweepLovableBadge(document), 1800);

    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes" && mutation.target instanceof Element) {
            if (isBadgeElement(mutation.target)) {
              findRemovableTarget(mutation.target).remove();
            }
            continue;
          }
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            const el = node as Element;
            if (isBadgeElement(el)) {
              findRemovableTarget(el).remove();
              return;
            }
            sweepLovableBadge(el);
          });
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["id", "class", "href", "data-lovable-badge", "style"],
      });
    }

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      observer?.disconnect();
    };
  }, []);

  return null;
}
