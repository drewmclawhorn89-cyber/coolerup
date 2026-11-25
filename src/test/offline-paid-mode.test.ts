import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_OFFLINE_VIDEOS, OfflineLimitError, MAX_OFFLINE_BYTES } from "@/lib/offline";
import {
  OFFLINE_MODE_EVENT,
  OFFLINE_MODE_KEY,
  isOfflineModeOn,
  setOfflineModeOn,
} from "@/lib/offlineMode";
import { syncOfflineLibrary } from "@/lib/offlineAutoDownload";
import {
  confirmPayment,
  getSubscription,
  planUnlocksOffline,
  requestPayment,
  updatePaymentMethod,
  type PaymentMethod,
} from "@/lib/subscriptions";
import { startTrial } from "@/lib/trial";
import {
  clearAccountSubscriptionCache,
  setCachedAccountSubscription,
} from "@/lib/accountSubscriptions";
import { setCachedLifetimeGrant } from "@/lib/subscription";

/**
 * Offline Mode is a paid-subscriber feature: no free hour, no downloads for
 * anyone without a live paid plan, a 50-video cap, and a storage meter with a
 * Clear Downloads button in Settings.
 */

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const settings = read("src/routes/settings.tsx");
const videos = read("src/routes/videos.tsx");
const offlineSrc = read("src/lib/offline.ts");
const paywall = read("src/components/OfflinePaywallDialog.tsx");
const watcher = read("src/components/OfflineAutoDownloadWatcher.tsx");
const hook = read("src/lib/useFullVideoOffline.ts");

const H = "paid-offline-tester";

const CARD: PaymentMethod = {
  provider: "card",
  brand: "visa",
  last4: "4242",
  expMonth: 9,
  expYear: 2032,
  holder: "Test User",
  addedAt: new Date().toISOString(),
};

function subscribe(planId = "pro") {
  requestPayment(H, planId);
  updatePaymentMethod(H, CARD);
  confirmPayment(H);
}

beforeEach(() => {
  localStorage.clear();
});

describe("50-video offline cap", () => {
  it("caps the library at 50 videos", () => {
    expect(MAX_OFFLINE_VIDEOS).toBe(50);
  });

  it("keeps the 500 MB byte budget alongside the video cap", () => {
    expect(MAX_OFFLINE_BYTES).toBe(500 * 1024 * 1024);
  });

  it("throws a friendly OfflineLimitError", () => {
    const error = new OfflineLimitError();
    expect(error.name).toBe("OfflineLimitError");
    expect(error.message).toContain("50 videos");
  });

  it("refuses a new save once the cap is reached, in both stores", () => {
    expect(offlineSrc).toMatch(/async function canSaveAnother/);
    expect(offlineSrc).toContain("full.length + shorts.length < MAX_OFFLINE_VIDEOS");
    const saveShorts = offlineSrc.slice(offlineSrc.indexOf("export async function saveOffline"));
    const saveFull = offlineSrc.slice(
      offlineSrc.indexOf("export async function saveFullVideoOffline"),
    );
    expect(saveShorts).toContain("canSaveAnother(video.id)");
    expect(saveFull).toContain("canSaveAnother(video.id)");
  });
});

describe("Offline Mode preference", () => {
  it("defaults to off", () => {
    expect(isOfflineModeOn()).toBe(false);
  });

  it("persists the toggle and notifies listeners", () => {
    let fired = 0;
    const listener = () => {
      fired += 1;
    };
    window.addEventListener(OFFLINE_MODE_EVENT, listener);
    setOfflineModeOn(true);
    window.removeEventListener(OFFLINE_MODE_EVENT, listener);

    expect(isOfflineModeOn()).toBe(true);
    expect(localStorage.getItem(OFFLINE_MODE_KEY)).toBe("true");
    expect(fired).toBe(1);

    setOfflineModeOn(false);
    expect(isOfflineModeOn()).toBe(false);
  });
});

describe("paid-only gating", () => {
  it("does not unlock offline from a free trial", () => {
    expect(planUnlocksOffline(H)).toBe(false);
    startTrial(H, "plus");
    // A trial is not a paid subscription, so offline stays locked.
    expect(planUnlocksOffline(H)).toBe(false);
  });

  it("unlocks offline once a paid plan is active", () => {
    subscribe("plus");
    expect(planUnlocksOffline(H)).toBe(true);
  });

  it("never downloads for a signed-out or free viewer", async () => {
    setOfflineModeOn(true);
    expect(await syncOfflineLibrary(null, null)).toEqual({
      downloaded: 0,
      skipped: 0,
      total: 0,
      capped: false,
    });
    expect(await syncOfflineLibrary("free-viewer", "user-1")).toEqual({
      downloaded: 0,
      skipped: 0,
      total: 0,
      capped: false,
    });
  });

  it("does nothing for a paid viewer with Offline Mode switched off", async () => {
    subscribe("pro");
    expect(isOfflineModeOn()).toBe(false);
    expect(await syncOfflineLibrary(H, "user-1")).toEqual({
      downloaded: 0,
      skipped: 0,
      total: 0,
      capped: false,
    });
  });

  it("does nothing while the device is offline", async () => {
    subscribe("pro");
    setOfflineModeOn(true);
    const original = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    try {
      expect(await syncOfflineLibrary(H, "user-1")).toEqual({
        downloaded: 0,
        skipped: 0,
        total: 0,
        capped: false,
      });
    } finally {
      if (original) Object.defineProperty(window.navigator, "onLine", original);
      else Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    }
  });

  it("the per-video hook opens a paywall instead of downloading", () => {
    expect(hook).toContain("useOfflineUnlocked");
    expect(hook).not.toContain("useTrial");
    expect(hook).toContain("setPaywallOpen(true)");
    expect(hook.indexOf("setPaywallOpen(true)")).toBeLessThan(
      hook.indexOf("saveFullVideoOffline(video"),
    );
  });
});

describe("the paywall dialog", () => {
  it("says offline mode is for paid subscribers and offers Subscribe", () => {
    expect(paywall).toContain("Offline Mode is for Paid Subscribers");
    expect(paywall).toContain("Subscribe");
    expect(paywall).toContain("subscriptions=1");
    expect(paywall).toContain("bg-black");
    expect(paywall).toContain("text-white");
  });
});

describe("Settings > Offline Mode", () => {
  it("has an Offline Mode toggle wired to the paid check", () => {
    expect(settings).toContain("Offline Mode");
    expect(settings).toContain('aria-label="Toggle Offline Mode"');
    expect(settings).toContain("useOfflineUnlocked(auth.handle)");
    expect(settings).toContain("setOfflineModeOn");
  });

  it("shows storage used, the 50-video count and Clear Downloads", () => {
    expect(settings).toContain("Offline storage:");
    expect(settings).toContain("Clear Downloads");
    expect(settings).toContain("MAX_OFFLINE_VIDEOS");
    expect(settings).toContain("getOfflineUsage()");
    expect(settings).toContain("clearAllDownloads");
  });

  it("opens the paywall for non-paid viewers and downloads nothing", () => {
    expect(settings).toContain("setShowOfflinePaywall(true)");
    expect(settings).toContain("<OfflinePaywallDialog");
    expect(settings).toContain("syncOfflineLibrary");
  });
});

describe("Videos > Offline tab", () => {
  it("appears when the device has no connection", () => {
    expect(videos).toContain("useIsOnline()");
    expect(videos).toContain("You're offline");
    expect(videos).toContain("offlineOnly");
  });

  it("plays downloaded videos from local blobs", () => {
    expect(videos).toContain("URL.createObjectURL");
    expect(videos).toContain("listSavedFullVideos()");
    expect(videos).toContain("listSaved()");
    expect(videos).toContain("offlinePlaying");
  });

  it("sends non-paid viewers to the paywall instead of toggling", () => {
    expect(videos).toContain("<OfflinePaywallDialog");
    expect(videos).toContain("setShowOfflinePaywall(true)");
  });
});

describe("automatic downloads", () => {
  it("only runs for paid plans with Offline Mode on", () => {
    expect(watcher).toContain("useOfflineUnlocked");
    expect(watcher).toContain("syncOfflineLibrary");
    expect(watcher).toContain("offlineMode");
  });

  it("syncs liked and saved videos, full-length first", () => {
    const src = read("src/lib/offlineAutoDownload.ts");
    expect(src).toContain("full_video_likes");
    expect(src).toContain("saved_full_videos");
    expect(src).toContain("fetchLikedVideos");
    expect(src).toContain("fetchSavedVideos");
    expect(src.indexOf("for (const video of fullVideos)")).toBeLessThan(
      src.indexOf("for (const video of shorts)"),
    );
  });

  it("skips YouTube-only and still-processing videos", () => {
    const src = read("src/lib/offlineAutoDownload.ts");
    expect(src).toContain("if (video.is_youtube) return false;");
    expect(src).toContain('video.status === "processing"');
    expect(src).toContain('video.status === "failed"');
  });
});

describe("a paid plan stored on the account", () => {
  const store = (
    planId: string,
    status: "active" | "pending" | "cancelled" | "expired" | "trialing",
  ) => setCachedAccountSubscription(H, { planId, status, startedAt: new Date().toISOString() });

  it("unlocks offline for a Pro row that is not a lifetime grant", () => {
    // The bug: only `is_lifetime` rows were honoured, so a real Pro
    // subscriber whose plan lived in `public.subscriptions` read as "no plan"
    // and saw the Plus upsell.
    store("pro", "active");
    expect(planUnlocksOffline(H)).toBe(true);
    expect(getSubscription(H)?.planId).toBe("pro");
    expect(getSubscription(H)?.isLifetime).toBe(false);
  });

  it("unlocks offline for every paid tier", () => {
    for (const plan of ["plus", "pro", "vip"]) {
      clearAccountSubscriptionCache();
      store(plan, "active");
      expect(planUnlocksOffline(H)).toBe(true);
    }
  });

  it("still unlocks the lifetime all-access grant", () => {
    setCachedLifetimeGrant(H, {
      plan: "all",
      status: "active",
      isLifetime: true,
      grantedBy: "drewmclawhorn3",
      grantedAt: null,
      revokedAt: null,
    });
    expect(planUnlocksOffline(H)).toBe(true);
    expect(getSubscription(H)?.isLifetime).toBe(true);
  });

  it("does not unlock a pending or cancelled account row", () => {
    store("pro", "pending");
    expect(planUnlocksOffline(H)).toBe(false);

    clearAccountSubscriptionCache();
    store("pro", "cancelled");
    expect(planUnlocksOffline(H)).toBe(false);
    expect(getSubscription(H)?.status).toBe("expired");
  });

  it("does not unlock an unknown plan id", () => {
    store("platinum", "active");
    expect(planUnlocksOffline(H)).toBe(false);
  });

  it("offline surfaces read the plan reactively", () => {
    const subs = read("src/lib/subscriptions.ts");
    expect(subs).toContain("export function useOfflineUnlocked");
    for (const file of [
      "src/routes/videos.tsx",
      "src/routes/settings.tsx",
      "src/routes/offline.tsx",
      "src/lib/useFullVideoOffline.ts",
      "src/components/ShareMenu.tsx",
      "src/components/OfflineAutoDownloadWatcher.tsx",
    ]) {
      expect(read(file)).toContain("useOfflineUnlocked");
    }
  });

  it("the paywall says every paid plan includes offline mode", () => {
    expect(paywall).toContain("every paid plan");
    expect(paywall).toContain("Plus, Pro and VIP");
  });
});
