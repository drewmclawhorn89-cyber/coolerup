import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InboxNotificationCard } from "@/components/InboxNotificationCard";
import {
  findHighlightedCommentId,
  parseCommentNotification,
  parseFollowHandle,
  type NotificationRow,
} from "@/lib/inboxNotifications";

describe("inbox notification helpers", () => {
  it("parses comment notifications into handle and comment preview", () => {
    expect(parseCommentNotification("alice commented: This is awesome!", null)).toEqual({
      username: "alice",
      bodyPrefix: "This is awesome!",
    });
    expect(parseCommentNotification("old_name commented: Love it", "new_name")).toEqual({
      username: "new_name",
      bodyPrefix: "Love it",
    });
    expect(parseCommentNotification("someone commented: ", "bob")).toEqual({
      username: "bob",
      bodyPrefix: null,
    });
  });

  it("parses follow handles with profile fallback", () => {
    expect(parseFollowHandle("drew started following you", null)).toBe("drew");
    expect(parseFollowHandle("old_handle started following you", "live_handle")).toBe(
      "live_handle",
    );
    expect(parseFollowHandle("Someone started following you", null)).toBeNull();
  });

  it("highlights the matching comment by username, text prefix, and closest timestamp", () => {
    const comments = [
      {
        id: "c1",
        username: "alice",
        body: "Nice!",
        created_at: "2026-11-20T10:00:00.000Z",
      },
      {
        id: "c2",
        username: "bob",
        body: "First comment",
        created_at: "2026-11-20T10:05:00.000Z",
      },
      {
        id: "c3",
        username: "alice",
        body: "Nice!",
        created_at: "2026-11-20T12:00:00.000Z",
      },
    ];

    expect(
      findHighlightedCommentId(comments, {
        username: "alice",
        bodyPrefix: "Nice!",
        createdAt: "2026-11-20T12:00:01.000Z",
      }),
    ).toBe("c3");

    expect(
      findHighlightedCommentId(comments, {
        username: "bob",
        bodyPrefix: null,
        createdAt: "2026-11-20T10:05:01.000Z",
      }),
    ).toBe("c2");
  });
});

describe("InboxNotificationCard", () => {
  it("uses the theme card variable without hardcoded blue and renders video thumbnail for likes", () => {
    const notif: NotificationRow = {
      id: "n1",
      type: "like",
      text: "alex liked your video",
      read: false,
      created_at: "2026-11-20T12:00:00.000Z",
      actor_user_id: "u1",
      target_user_id: "u2",
      video_id: "v1",
    };

    render(
      <InboxNotificationCard
        notification={notif}
        actor={{
          id: "u1",
          handle: "alex",
          display_name: "Alex",
          avatar_url: "https://example.com/alex.jpg",
        }}
        video={{
          id: "v1",
          username: "creator",
          caption: "Test video",
          video_url: "https://example.com/clip.mp4",
          likes_count: 5,
          comments_count: 1,
          shares_count: 0,
          created_at: "2026-11-20T11:00:00.000Z",
        }}
        onSelect={() => {}}
      />,
    );

    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-card");
    expect(btn.className).toContain("text-card-foreground");
    expect(btn.className).not.toMatch(/blue|#2563EB|#1d4fc4/i);
    const videoEl = document.querySelector("video");
    expect(videoEl).toBeTruthy();
    expect(videoEl?.getAttribute("src")).toContain("https://example.com/clip.mp4");
  });

  it("renders follower profile pic on follow notifications without a video thumbnail", () => {
    const notif: NotificationRow = {
      id: "n2",
      type: "follow",
      text: "sam started following you",
      read: true,
      created_at: "2026-11-20T12:00:00.000Z",
      actor_user_id: "u3",
      target_user_id: "u2",
      video_id: null,
    };

    render(
      <InboxNotificationCard
        notification={notif}
        actor={{
          id: "u3",
          handle: "sam",
          display_name: "Sam",
          avatar_url: "https://example.com/sam.jpg",
        }}
        onSelect={() => {}}
      />,
    );

    const img = screen.getByAltText("@sam");
    expect(img).toHaveAttribute("src", "https://example.com/sam.jpg");
    expect(document.querySelector("video")).toBeNull();
  });
});
