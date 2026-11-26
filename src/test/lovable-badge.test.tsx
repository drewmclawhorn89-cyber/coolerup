import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LovableBadgeGuard } from "@/components/LovableBadgeGuard";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("Lovable badge removal", () => {
  it("removes existing badge nodes, wrappers, and X close buttons while keeping app buttons and links", () => {
    document.body.innerHTML = `
      <div id="lovable-badge-wrapper" style="position: fixed; bottom: 16px; right: 16px;">
        <a id="lovable-badge" data-lovable-badge href="https://lovable.dev/projects/x">Edit with Lovable</a>
        <button id="lovable-badge-close" aria-label="Close">×</button>
      </div>
      <div class="lovable-badge">badge</div>
      <nav aria-label="Phone navigation">
        <a id="profile-tab" href="/u/drew">Profile</a>
      </nav>
      <a id="keep-link" href="https://coolerup.lovable.app/about">About</a>
      <button id="keep-btn">Like</button>
    `;

    render(<LovableBadgeGuard />);

    expect(document.getElementById("lovable-badge-wrapper")).toBeNull();
    expect(document.getElementById("lovable-badge")).toBeNull();
    expect(document.getElementById("lovable-badge-close")).toBeNull();
    expect(document.querySelector("[data-lovable-badge]")).toBeNull();
    expect(document.querySelector(".lovable-badge")).toBeNull();
    expect(document.getElementById("profile-tab")).not.toBeNull();
    expect(document.getElementById("keep-btn")).not.toBeNull();
    expect(document.getElementById("keep-link")).not.toBeNull();
  });

  it("removes an unmarked floating wrapper div containing the badge link and a close X button", () => {
    document.body.innerHTML = `
      <div id="floating-wrap" style="position: fixed; bottom: 12px; right: 12px;">
        <a href="https://lovable.dev/projects/coolerup">Edit with Lovable</a>
        <button id="orphan-x" type="button" aria-label="Dismiss">×</button>
      </div>
    `;

    render(<LovableBadgeGuard />);

    expect(document.getElementById("floating-wrap")).toBeNull();
    expect(document.getElementById("orphan-x")).toBeNull();
  });

  it("removes a badge container and X button injected after mount", async () => {
    render(<LovableBadgeGuard />);

    const wrapper = document.createElement("div");
    wrapper.id = "lovable-badge";
    const badge = document.createElement("a");
    badge.setAttribute("data-lovable-badge", "");
    badge.href = "https://lovable.dev/x";
    badge.textContent = "Edit with Lovable";
    const closeBtn = document.createElement("button");
    closeBtn.id = "lovable-badge-close";
    closeBtn.textContent = "×";
    wrapper.appendChild(badge);
    wrapper.appendChild(closeBtn);
    document.body.appendChild(wrapper);

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.getElementById("lovable-badge")).toBeNull();
    expect(document.getElementById("lovable-badge-close")).toBeNull();
    expect(document.querySelector("[data-lovable-badge]")).toBeNull();
  });

  it("removes injected Lovable badge iframes and scripts", () => {
    document.body.innerHTML = `
      <iframe title="Edit with Lovable" src="https://lovable.dev/badge.html"></iframe>
      <script src="https://cdn.lovable.dev/badge.js"></script>
      <iframe id="yt-embed" src="https://www.youtube.com/embed/abc"></iframe>
    `;

    render(<LovableBadgeGuard />);

    expect(document.querySelector("iframe[title='Edit with Lovable']")).toBeNull();
    expect(document.querySelector("script[src*='lovable.dev/badge']")).toBeNull();
    expect(document.getElementById("yt-embed")).not.toBeNull();
  });
});
