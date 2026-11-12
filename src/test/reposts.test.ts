import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNotInterested,
  isNotInterested,
  markNotInterested,
  NOT_INTERESTED_EVENT,
  NOT_INTERESTED_KEY,
  pickRepostAttribution,
} from "@/lib/reposts";

describe("not interested", () => {
  beforeEach(() => {
    window.localStorage.removeItem(NOT_INTERESTED_KEY);
  });

  it("starts empty", () => {
    expect(isNotInterested("v1")).toBe(false);
  });

  it("marks a video and persists it", () => {
    markNotInterested("v1");
    expect(isNotInterested("v1")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(NOT_INTERESTED_KEY) ?? "[]")).toEqual(["v1"]);
  });

  it("does not add the same video twice", () => {
    markNotInterested("v1");
    markNotInterested("v1");
    expect(JSON.parse(window.localStorage.getItem(NOT_INTERESTED_KEY) ?? "[]")).toEqual(["v1"]);
  });

  it("fires the event the feed listens for", () => {
    let fired = 0;
    const onEvent = () => {
      fired += 1;
    };
    window.addEventListener(NOT_INTERESTED_EVENT, onEvent);
    markNotInterested("v2");
    window.removeEventListener(NOT_INTERESTED_EVENT, onEvent);
    expect(fired).toBe(1);
  });

  it("clears one video or everything", () => {
    markNotInterested("v1");
    markNotInterested("v2");
    clearNotInterested("v1");
    expect(isNotInterested("v1")).toBe(false);
    expect(isNotInterested("v2")).toBe(true);
    clearNotInterested();
    expect(isNotInterested("v2")).toBe(false);
  });

  it("survives corrupt storage", () => {
    window.localStorage.setItem(NOT_INTERESTED_KEY, "{not json");
    expect(isNotInterested("v1")).toBe(false);
    markNotInterested("v1");
    expect(isNotInterested("v1")).toBe(true);
  });
});

describe("pickRepostAttribution", () => {
  const handles = new Map([
    ["u1", "ana"],
    ["u2", "ben"],
    ["u3", "cleo"],
  ]);

  it("keeps the newest reposter when nobody is followed", () => {
    const map = pickRepostAttribution(
      [
        { video_id: "v1", user_id: "u2" },
        { video_id: "v1", user_id: "u1" },
      ],
      handles,
    );
    expect(map.get("v1")).toBe("ben");
  });

  it("prefers a followed handle over a newer stranger", () => {
    const map = pickRepostAttribution(
      [
        { video_id: "v1", user_id: "u2" },
        { video_id: "v1", user_id: "u1" },
      ],
      handles,
      ["ana"],
    );
    expect(map.get("v1")).toBe("ana");
  });

  it("does not swap a followed handle for another followed handle", () => {
    const map = pickRepostAttribution(
      [
        { video_id: "v1", user_id: "u2" },
        { video_id: "v1", user_id: "u3" },
      ],
      handles,
      ["ana", "ben", "cleo"],
    );
    expect(map.get("v1")).toBe("ben");
  });

  it("maps each video independently and skips unknown users", () => {
    const map = pickRepostAttribution(
      [
        { video_id: "v1", user_id: "u1" },
        { video_id: "v2", user_id: "u3" },
        { video_id: "v3", user_id: "ghost" },
      ],
      handles,
    );
    expect(map.get("v1")).toBe("ana");
    expect(map.get("v2")).toBe("cleo");
    expect(map.has("v3")).toBe(false);
  });

  it("is empty for no rows", () => {
    expect(pickRepostAttribution([], handles).size).toBe(0);
  });
});
