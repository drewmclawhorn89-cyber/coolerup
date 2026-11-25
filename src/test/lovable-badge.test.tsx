import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LovableBadgeGuard } from "@/components/LovableBadgeGuard";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("Lovable badge removal", () => {
  it("removes existing badge nodes but keeps normal buttons and links", () => {
    document.body.innerHTML = `
      <a data-lovable-badge href="https://lovable.dev/projects/x">Edit with Lovable</a>
      <div class="lovable-badge">badge</div>
      <a id="keep-link" href="https://coolerup.lovable.app/about">About</a>
      <button id="keep-btn">Like</button>
    `;

    render(<LovableBadgeGuard />);

    expect(document.querySelector("[data-lovable-badge]")).toBeNull();
    expect(document.querySelector(".lovable-badge")).toBeNull();
    // The href*="lovable" link is hidden by CSS, not removed by the guard, and
    // unrelated elements are untouched.
    expect(document.getElementById("keep-btn")).not.toBeNull();
    expect(document.getElementById("keep-link")).not.toBeNull();
  });

  it("removes a badge injected after mount", async () => {
    render(<LovableBadgeGuard />);

    const badge = document.createElement("a");
    badge.setAttribute("data-lovable-badge", "");
    badge.href = "https://lovable.dev/x";
    badge.textContent = "Edit with Lovable";
    document.body.appendChild(badge);

    // MutationObserver callbacks run on a microtask.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector("[data-lovable-badge]")).toBeNull();
  });
});
