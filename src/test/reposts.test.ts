import { beforeEach, describe, expect, it } from "vitest";
import {
  clearNotInterested,
  isNotInterested,
  markNotInterested,
  NOT_INTERESTED_EVENT,
  NOT_INTERESTED_KEY,
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
