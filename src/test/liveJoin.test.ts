import { describe, expect, it } from "vitest";

import {
  JOIN_STATUS_COPY,
  MAX_GUESTS,
  activeGuests,
  guestGridClass,
  guestName,
  joinBannerText,
  liveWithLine,
  pendingRequests,
  requestName,
  stageHasRoom,
  stageUsage,
  type JoinRequest,
  type LiveGuest,
} from "@/lib/liveJoin";

const request = (over: Partial<JoinRequest> = {}): JoinRequest => ({
  id: "r1",
  live_id: "host-1",
  requester_id: "u2",
  status: "pending",
  created_at: new Date(0).toISOString(),
  responded_at: null,
  profile: { username: "john", handle: "johnny", avatar_url: null },
  ...over,
});

const guest = (over: Partial<LiveGuest> = {}): LiveGuest => ({
  id: "g1",
  live_id: "host-1",
  user_id: "u2",
  joined_at: new Date(0).toISOString(),
  is_active: true,
  profile: { username: "john", handle: "johnny", avatar_url: null },
  ...over,
});

describe("activeGuests", () => {
  it("keeps only guests still on stage", () => {
    const list = [guest({ id: "a" }), guest({ id: "b", is_active: false })];
    expect(activeGuests(list).map((item) => item.id)).toEqual(["a"]);
  });

  it("handles an empty stage", () => {
    expect(activeGuests([])).toEqual([]);
  });
});

describe("pendingRequests", () => {
  it("keeps only pending requests", () => {
    const list = [
      request({ id: "a" }),
      request({ id: "b", status: "accepted" }),
      request({ id: "c", status: "rejected" }),
      request({ id: "d", status: "ended" }),
    ];
    expect(pendingRequests(list).map((item) => item.id)).toEqual(["a"]);
  });
});

describe("names", () => {
  it("uses the username for a request", () => {
    expect(requestName(request())).toBe("john");
  });

  it("falls back to the handle for a request", () => {
    expect(requestName(request({ profile: { username: null, handle: "johnny" } }))).toBe("johnny");
  });

  it("falls back to Someone when the profile is missing", () => {
    expect(requestName(request({ profile: null }))).toBe("Someone");
  });

  it("uses the username for a guest", () => {
    expect(guestName(guest())).toBe("john");
  });

  it("falls back to Guest when the profile is missing", () => {
    expect(guestName(guest({ profile: null }))).toBe("Guest");
  });
});

describe("stageHasRoom", () => {
  it("has room on an empty stage", () => {
    expect(stageHasRoom([])).toBe(true);
  });

  it("has room below the cap", () => {
    expect(stageHasRoom([guest(), guest()])).toBe(true);
  });

  it("is full at the cap", () => {
    const full = Array.from({ length: MAX_GUESTS }, (_, i) =>
      guest({ id: `g${i}`, user_id: `u${i}` }),
    );
    expect(stageHasRoom(full)).toBe(false);
  });

  it("ignores guests who already left", () => {
    const full = Array.from({ length: MAX_GUESTS }, (_, i) =>
      guest({ id: `g${i}`, user_id: `u${i}` }),
    );
    full[0] = guest({ id: "gone", user_id: "gone", is_active: false });
    expect(stageHasRoom(full)).toBe(true);
  });
});

describe("guestGridClass", () => {
  it("fills the screen for one tile", () => {
    expect(guestGridClass(1)).toBe("grid-cols-1 grid-rows-1");
  });

  it("stacks two tiles", () => {
    expect(guestGridClass(2)).toBe("grid-cols-1 grid-rows-2");
  });

  it("uses 2x2 for three and four tiles", () => {
    expect(guestGridClass(3)).toBe("grid-cols-2 grid-rows-2");
    expect(guestGridClass(4)).toBe("grid-cols-2 grid-rows-2");
  });

  it("grows to 2x3 for five and six tiles", () => {
    expect(guestGridClass(5)).toBe("grid-cols-2 grid-rows-3");
    expect(guestGridClass(6)).toBe("grid-cols-2 grid-rows-3");
  });
});

describe("liveWithLine", () => {
  it("shows just the host when nobody has joined", () => {
    expect(liveWithLine("sam", [])).toBe("LIVE with @sam");
  });

  it("lists the guests on stage", () => {
    expect(liveWithLine("sam", [guest()])).toBe("LIVE with @sam + @john");
  });

  it("skips guests who left", () => {
    expect(liveWithLine("sam", [guest({ is_active: false })])).toBe("LIVE with @sam");
  });

  it("lists several guests in order", () => {
    const list = [
      guest({ id: "a", profile: { username: "ana", handle: null } }),
      guest({ id: "b", profile: { username: "bo", handle: null } }),
    ];
    expect(liveWithLine("sam", list)).toBe("LIVE with @sam + @ana, @bo");
  });
});

describe("joinBannerText", () => {
  it("names the viewer asking to join", () => {
    expect(joinBannerText(request())).toBe("john wants to join LIVE");
  });

  it("still reads well without a profile", () => {
    expect(joinBannerText(request({ profile: null }))).toBe("Someone wants to join LIVE");
  });
});

describe("stageUsage", () => {
  it("counts used spots", () => {
    expect(stageUsage([])).toBe("0 of 4 guest spots used");
    expect(stageUsage([guest()])).toBe("1 of 4 guest spots used");
  });

  it("ignores guests who left", () => {
    expect(stageUsage([guest({ is_active: false })])).toBe("0 of 4 guest spots used");
  });
});

describe("constants", () => {
  it("allows four guests", () => {
    expect(MAX_GUESTS).toBe(4);
  });

  it("has copy for every join status", () => {
    expect(Object.keys(JOIN_STATUS_COPY).sort()).toEqual([
      "accepted",
      "ended",
      "pending",
      "rejected",
    ]);
    expect(JOIN_STATUS_COPY.accepted).toBe("You're on LIVE");
  });
});
