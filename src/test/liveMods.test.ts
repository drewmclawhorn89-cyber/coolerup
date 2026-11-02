import { describe, expect, it } from "vitest";

import {
  MAX_MODS,
  MUTE_OPTIONS,
  activeMuteFor,
  blockAnnouncement,
  canManageMods,
  canModerate,
  displayName,
  modAnnouncement,
  muteAnnouncement,
  muteIsActive,
  muteLabel,
  roleFor,
  unmodAnnouncement,
  type LiveMod,
  type LiveMute,
} from "@/lib/liveMods";

const mod = (userId: string): Pick<LiveMod, "user_id"> => ({ user_id: userId });

const mute = (until: string | null, userId = "u-muted"): LiveMute => ({
  id: `mute-${userId}`,
  live_id: "host-1",
  user_id: userId,
  muted_by: "host-1",
  until,
  created_at: new Date(0).toISOString(),
});

describe("roleFor", () => {
  it("treats the room owner as host", () => {
    expect(roleFor({ hostId: "host-1", userId: "host-1", mods: [] })).toBe("host");
  });

  it("treats a listed user as a mod", () => {
    expect(roleFor({ hostId: "host-1", userId: "u2", mods: [mod("u2")] })).toBe("mod");
  });

  it("treats everyone else as a viewer", () => {
    expect(roleFor({ hostId: "host-1", userId: "u3", mods: [mod("u2")] })).toBe("viewer");
  });

  it("is a viewer when nobody is signed in", () => {
    expect(roleFor({ hostId: "host-1", userId: null, mods: [mod("u2")] })).toBe("viewer");
  });

  it("never promotes the host to mod even if the host is in the mod list", () => {
    expect(roleFor({ hostId: "host-1", userId: "host-1", mods: [mod("host-1")] })).toBe("host");
  });

  it("is a viewer when the room has no host id yet", () => {
    expect(roleFor({ hostId: null, userId: "u2", mods: [] })).toBe("viewer");
  });
});

describe("permissions", () => {
  it("lets hosts and mods moderate", () => {
    expect(canModerate("host")).toBe(true);
    expect(canModerate("mod")).toBe(true);
    expect(canModerate("viewer")).toBe(false);
  });

  it("lets only the host manage the mod list", () => {
    expect(canManageMods("host")).toBe(true);
    expect(canManageMods("mod")).toBe(false);
    expect(canManageMods("viewer")).toBe(false);
  });
});

describe("muteIsActive", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("keeps a permanent mute active forever", () => {
    expect(muteIsActive({ until: null }, now)).toBe(true);
  });

  it("keeps a mute active before it expires", () => {
    expect(muteIsActive({ until: "2026-01-01T12:04:00Z" }, now)).toBe(true);
  });

  it("drops a mute once it has expired", () => {
    expect(muteIsActive({ until: "2026-01-01T11:59:00Z" }, now)).toBe(false);
  });
});

describe("activeMuteFor", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("finds the live mute for a user", () => {
    const found = activeMuteFor([mute(null, "u2")], "u2", now);
    expect(found?.user_id).toBe("u2");
  });

  it("ignores expired mutes", () => {
    expect(activeMuteFor([mute("2026-01-01T11:00:00Z", "u2")], "u2", now)).toBeNull();
  });

  it("returns null for an unknown user", () => {
    expect(activeMuteFor([mute(null, "u2")], "u9", now)).toBeNull();
  });

  it("returns null when there is no signed-in user", () => {
    expect(activeMuteFor([mute(null, "u2")], null, now)).toBeNull();
  });
});

describe("muteLabel", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("labels a permanent mute", () => {
    expect(muteLabel({ until: null }, now)).toBe("permanent");
  });

  it("rounds the remaining minutes", () => {
    expect(muteLabel({ until: "2026-01-01T12:05:00Z" }, now)).toBe("5m");
    expect(muteLabel({ until: "2026-01-01T12:10:00Z" }, now)).toBe("10m");
  });

  it("never shows less than one minute", () => {
    expect(muteLabel({ until: "2026-01-01T12:00:10Z" }, now)).toBe("1m");
  });
});

describe("announcements", () => {
  it("announces a promotion with the shield emoji", () => {
    expect(modAnnouncement("john")).toBe("@john is now moderator 🛡️");
  });

  it("announces a demotion", () => {
    expect(unmodAnnouncement("john")).toBe("@john is no longer a moderator");
  });

  it("announces a timed mute with its duration", () => {
    const now = Date.now();
    const until = new Date(now + 5 * 60000).toISOString();
    expect(muteAnnouncement("john", { until })).toBe("@john was muted (5m)");
  });

  it("announces a permanent mute", () => {
    expect(muteAnnouncement("john", { until: null })).toBe("@john was muted (permanent)");
  });

  it("announces a block", () => {
    expect(blockAnnouncement("john")).toBe("@john was removed from this LIVE");
  });
});

describe("displayName", () => {
  it("prefers the username", () => {
    expect(displayName({ username: "john", handle: "johnny" })).toBe("john");
  });

  it("falls back to the handle", () => {
    expect(displayName({ username: null, handle: "johnny" })).toBe("johnny");
  });

  it("falls back to guest", () => {
    expect(displayName({})).toBe("guest");
  });
});

describe("constants", () => {
  it("caps the room at 20 moderators", () => {
    expect(MAX_MODS).toBe(20);
  });

  it("offers 5 minute, 10 minute and permanent mutes", () => {
    expect(MUTE_OPTIONS.map((option) => option.id)).toEqual(["5", "10", "permanent"]);
    expect(MUTE_OPTIONS.map((option) => option.minutes)).toEqual([5, 10, null]);
  });
});
