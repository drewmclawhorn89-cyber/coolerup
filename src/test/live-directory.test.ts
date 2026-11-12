import { describe, expect, it } from "vitest";
import { hostsFromPresence } from "@/lib/liveDirectory";

describe("live directory presence", () => {
  it("keeps only live entries with an identity", () => {
    const hosts = hostsFromPresence([
      { userId: "u1", username: "ana", title: "Chilling", since: 10, live: true },
      { userId: "u2", username: "ben", live: false },
      { userId: "u3", live: true },
      { username: "ghost", live: true },
    ]);
    expect(hosts.map((h) => h.userId)).toEqual(["u1"]);
  });

  it("de-duplicates the same host and keeps the last title", () => {
    const hosts = hostsFromPresence([
      { userId: "u1", username: "ana", title: "Old title", since: 10, live: true },
      { userId: "u1", username: "ana", title: "New title", since: 10, live: true },
    ]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.title).toBe("New title");
  });

  it("orders by when the host went live", () => {
    const hosts = hostsFromPresence([
      { userId: "late", username: "late", since: 900, live: true },
      { userId: "early", username: "early", since: 100, live: true },
    ]);
    expect(hosts.map((h) => h.userId)).toEqual(["early", "late"]);
  });

  it("falls back to a default title", () => {
    const hosts = hostsFromPresence([{ userId: "u1", username: "ana", since: 5, live: true }]);
    expect(hosts[0]!.title).toBe("Live now");
  });

  it("returns an empty list when nobody is live", () => {
    expect(hostsFromPresence([])).toEqual([]);
  });
});
