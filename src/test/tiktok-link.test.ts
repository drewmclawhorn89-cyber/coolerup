import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  TIKTOK_AUTHORIZE_URL,
  TIKTOK_POSTED_FROM,
  TIKTOK_SCOPES,
  buildAuthorizeUrl,
  openState,
  sealState,
  tiktokCaption,
} from "@/lib/tiktokLink.server";

/**
 * "Link TikTok Account" is the one feature in Coolerup that touches somebody
 * else's platform on the user's behalf, so the rules are pinned here:
 *
 *   1. The user logs in on TikTok's own screen (Login Kit), never ours.
 *   2. Every TikTok call uses that user's own token, so only their own
 *      videos are readable and only their own account is writable.
 *   3. Tokens never reach the browser — the table has RLS on with no
 *      select policy, and the RPC returns a token-free projection.
 *   4. Every cross-post carries "Posted from Coolerup".
 */

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("tiktokCaption", () => {
  it("appends the Posted from Coolerup tag after a blank line", () => {
    expect(tiktokCaption("Sunset over the pier")).toBe(
      `Sunset over the pier\n\n${TIKTOK_POSTED_FROM}`,
    );
  });

  it("uses only the tag when the caption is empty", () => {
    expect(tiktokCaption("")).toBe(TIKTOK_POSTED_FROM);
    expect(tiktokCaption("   ")).toBe(TIKTOK_POSTED_FROM);
  });

  it("keeps the tag even when the caption is at the length limit", () => {
    const out = tiktokCaption("x".repeat(5000));
    expect(out.length).toBeLessThanOrEqual(2100);
    expect(out.endsWith(TIKTOK_POSTED_FROM)).toBe(true);
  });

  it("names Coolerup exactly once", () => {
    const out = tiktokCaption("hello");
    expect(out.match(/Posted from Coolerup/g)).toHaveLength(1);
  });
});

describe("sealed OAuth state", () => {
  it("round-trips the user id", () => {
    const state = sealState({ userId: "user-123", exp: Date.now() + 60_000 });
    expect(openState(state)).toMatchObject({ userId: "user-123" });
  });

  it("does not leak the user id in the URL-safe blob", () => {
    const state = sealState({ userId: "user-123", exp: Date.now() + 60_000 });
    expect(state).not.toContain("user-123");
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a tampered state", () => {
    const state = sealState({ userId: "user-123", exp: Date.now() + 60_000 });
    const flipped = state.slice(0, -1) + (state.endsWith("A") ? "B" : "A");
    expect(openState(flipped)).toBeNull();
  });

  it("rejects an expired state", () => {
    const state = sealState({ userId: "user-123", exp: Date.now() - 1 });
    expect(openState(state)).toBeNull();
  });

  it("rejects garbage and null", () => {
    expect(openState(null)).toBeNull();
    expect(openState("not-a-real-state")).toBeNull();
  });
});

describe("buildAuthorizeUrl", () => {
  const request = new Request("https://coolerup.example/api/tiktok/auth/url");

  beforeEach(() => {
    process.env["TIKTOK_CLIENT_KEY"] = "test-client-key";
    process.env["TIKTOK_CLIENT_SECRET"] = "test-client-secret";
    delete process.env["APP_URL"];
  });

  afterEach(() => {
    delete process.env["TIKTOK_CLIENT_KEY"];
    delete process.env["TIKTOK_CLIENT_SECRET"];
    delete process.env["APP_URL"];
  });

  it("points at TikTok's own login screen", () => {
    const url = new URL(buildAuthorizeUrl(request, "user-1")!);
    expect(`${url.origin}${url.pathname}`).toBe(TIKTOK_AUTHORIZE_URL);
  });

  it("asks for the scopes the feature needs", () => {
    const url = new URL(buildAuthorizeUrl(request, "user-1")!);
    expect(url.searchParams.get("scope")).toBe(TIKTOK_SCOPES);
    for (const scope of ["user.info.basic", "user.info.stats", "video.list"]) {
      expect(url.searchParams.get("scope")).toContain(scope);
    }
    expect(url.searchParams.get("scope")).toContain("video.publish");
  });

  it("forces the account picker so the user chooses their own account", () => {
    const url = new URL(buildAuthorizeUrl(request, "user-1")!);
    expect(url.searchParams.get("disable_auto_auth")).toBe("1");
  });

  it("carries a sealed state that resolves back to the caller", () => {
    const url = new URL(buildAuthorizeUrl(request, "user-1")!);
    expect(openState(url.searchParams.get("state"))).toMatchObject({ userId: "user-1" });
  });

  it("redirects to the callback route", () => {
    const url = new URL(buildAuthorizeUrl(request, "user-1")!);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://coolerup.example/api/tiktok/auth/callback",
    );
  });

  it("returns null when the app is not configured", () => {
    delete process.env["TIKTOK_CLIENT_KEY"];
    expect(buildAuthorizeUrl(request, "user-1")).toBeNull();
  });
});

describe("migration", () => {
  const sql = read("supabase/migrations/20261221000000_tiktok_linked_accounts.sql");

  it("creates the three tables", () => {
    for (const table of ["tiktok_accounts", "tiktok_publishes", "tiktok_imports"]) {
      expect(sql).toContain(`public.${table}`);
    }
  });

  it("locks tokens away from clients", () => {
    expect(sql).toMatch(/alter table public\.tiktok_accounts enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.tiktok_accounts from anon, authenticated/i);
    // No policy may grant select on the token table.
    expect(sql).not.toMatch(/create policy[^;]*on public\.tiktok_accounts/i);
  });

  it("exposes a token-free projection through a definer function", () => {
    expect(sql).toMatch(/create or replace function public\.my_tiktok_account\(\)/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    const fn = sql.slice(sql.indexOf("my_tiktok_account()"));
    expect(fn).not.toMatch(/access_token\s*,/i);
    expect(fn).not.toMatch(/refresh_token\s*,/i);
  });

  it("scopes publishes and imports to the owner", () => {
    expect(sql).toMatch(/user_id uuid not null references auth\.users/i);
    expect(sql).toMatch(/primary key \(user_id, tiktok_id\)/i);
  });
});

describe("API routes", () => {
  const route = (p: string) => read(`src/routes/api/tiktok/${p}`);

  it("ships every route the UI calls", () => {
    for (const p of ["auth/url.ts", "auth/callback.ts", "unlink.ts", "videos.ts", "publish.ts"]) {
      expect(existsSync(resolve(ROOT, "src/routes/api/tiktok", p))).toBe(true);
    }
  });

  it("never lets a caller ask for someone else's videos", () => {
    const videos = route("videos.ts");
    // No handle / open_id / username input at all: the token decides whose list.
    expect(videos).not.toMatch(/searchParams\.get\(\s*["'](handle|username|open_id|user_id)["']/);
    expect(videos).toMatch(/freshAccessToken/);
    expect(videos).toMatch(/listMyVideos/);
  });

  it("refuses to publish a video the caller does not own", () => {
    const publish = route("publish.ts");
    expect(publish).toMatch(/callerFromRequest/);
    expect(publish).toMatch(/\.eq\(\s*["']user_id["']\s*,\s*caller\.userId\s*\)/);
    expect(publish).toMatch(/403/);
  });

  it("only unlinks the caller's own row", () => {
    const unlink = route("unlink.ts");
    expect(unlink).toMatch(/callerFromRequest/);
    expect(unlink).toMatch(/unlinkAccount\(caller\.userId\)/);
  });

  it("reports not-configured instead of throwing", () => {
    expect(route("auth/url.ts")).toMatch(/configured:\s*false/);
  });

  it("hands the popup back to the opener with a message", () => {
    const callback = route("auth/callback.ts");
    expect(callback).toMatch(/TIKTOK_LINK_SUCCESS/);
    expect(callback).toMatch(/TIKTOK_LINK_ERROR/);
    expect(callback).toMatch(/window\.opener/);
  });
});

describe("UI wiring", () => {
  const settings = read("src/routes/settings.tsx");
  const linked = read("src/components/TikTokLinkedAccounts.tsx");
  const toggle = read("src/components/TikTokPostFields.tsx");
  const importer = read("src/components/ImportFromTikTok.tsx");
  const card = read("src/components/TikTokProfileCard.tsx");
  const upload = read("src/components/UploadDialog.tsx");
  const profile = read("src/routes/u.$username.tsx");

  it("mounts the Linked Accounts card in Settings", () => {
    expect(settings).toContain("TikTokLinkedAccounts");
    expect(settings).toContain("<TikTokLinkedAccounts");
  });

  it("labels the button exactly as asked", () => {
    expect(linked).toContain("Link TikTok Account");
    expect(linked).toContain("Connected as @");
    expect(linked).toContain("Unlink");
  });

  it("offers Import from TikTok", () => {
    expect(linked).toContain("Import from TikTok");
    expect(importer).toContain("listMyTikTokVideos");
  });

  it("adds the Also post to TikTok toggle to the composer", () => {
    expect(upload).toContain("TikTokPostFields");
    expect(upload).toContain("publishVideoToTikTok");
    expect(toggle).toContain("Also post to TikTok");
    expect(toggle).toContain('role="switch"');
  });

  it("shows the follower counts and both share buttons on your own profile", () => {
    expect(profile).toContain("TikTokProfileCard");
    expect(profile).toMatch(/\{isOwn && <TikTokProfileCard/);
    expect(card).toContain("TikTok followers");
    expect(card).toContain("Coolerup followers");
    expect(card).toContain("Share Coolerup to TikTok");
    expect(card).toContain("Share TikTok to Coolerup");
  });

  it("keeps the black background and white text", () => {
    for (const src of [linked, toggle, importer, card]) {
      expect(src).toMatch(/backgroundColor:\s*["'](black|#000|#000000)["']/i);
      expect(src).toMatch(/color:\s*["'](white|#fff|#ffffff)["']/i);
    }
  });
});
