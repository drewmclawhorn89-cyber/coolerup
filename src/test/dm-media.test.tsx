import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  return {
    profilesResult: { data: null as Record<string, unknown> | null, error: null as unknown },
    followsQueue: [] as Array<{ data: { id: string } | null }>,
    rpcMock: vi.fn(),
    storageCreateSignedUrl: vi.fn(),
    prepareWatermarkedFileMock: vi.fn(),
    saveFileToDiskMock: vi.fn(),
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const chainable = (table: string) => {
    const query: Record<string, unknown> = {};
    const next = () => query;
    query["select"] = vi.fn(next);
    query["eq"] = vi.fn(next);
    query["ilike"] = vi.fn(next);
    query["or"] = vi.fn(next);
    query["order"] = vi.fn(next);
    query["limit"] = vi.fn(next);
    query["range"] = vi.fn(async () => ({ data: [], error: null }));
    query["maybeSingle"] = vi.fn(async () => {
      if (table === "profiles") return mocks.profilesResult;
      if (table === "follows") return mocks.followsQueue.shift() ?? { data: null };
      return { data: null, error: null };
    });
    return query;
  };
  return {
    supabase: {
      from: vi.fn((table: string) => chainable(table)),
      rpc: mocks.rpcMock,
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: mocks.storageCreateSignedUrl,
        })),
      },
    },
  };
});

vi.mock("@/lib/untypedDb", () => ({
  untypedDb: {
    from: vi.fn((table: string) => {
      const query: Record<string, unknown> = {};
      const next = () => query;
      query["select"] = vi.fn(next);
      query["eq"] = vi.fn(next);
      query["ilike"] = vi.fn(next);
      query["or"] = vi.fn(next);
      query["order"] = vi.fn(next);
      query["limit"] = vi.fn(next);
      query["range"] = vi.fn(async () => ({ data: [], error: null }));
      query["maybeSingle"] = vi.fn(async () => {
        if (table === "profiles") return mocks.profilesResult;
        return { data: null, error: null };
      });
      return query;
    }),
    rpc: mocks.rpcMock,
  },
}));

vi.mock("@/lib/watermark", () => ({
  downloadExtension: () => "mp4",
  prepareWatermarkedFile: mocks.prepareWatermarkedFileMock,
  saveFileToDisk: mocks.saveFileToDiskMock,
  WatermarkError: class WatermarkError extends Error {},
  watermarkCause: () => "",
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    ready: true,
    user: { id: "user-1" },
    handle: "alice",
    signIn: vi.fn(),
  }),
}));

import {
  checkDmMediaPermission,
  fetchDirectMessages,
  isViewOnceExpired,
  normalizeDmRow,
  openViewOnceMedia,
  saveDmMediaToDevice,
  withLegacyDmMediaMessage,
  type DirectMessage,
} from "@/lib/dmMedia";
import { DmAttachmentSheet } from "@/components/DmAttachmentSheet";
import { DmMediaLightbox } from "@/components/DmMediaLightbox";
import { DmMediaActionSheet } from "@/components/DmMediaActionSheet";

function makeMsg(overrides: Partial<DirectMessage> = {}): DirectMessage {
  return {
    id: "dm-1",
    from_id: "user-2",
    to_id: "user-1",
    from_username: "bob",
    to_username: "alice",
    message: "",
    gif_url: null,
    gif_credit: null,
    media_url: "https://cdn.example.com/photo.jpg",
    media_type: "image",
    media_video_id: null,
    media_caption: null,
    media_has_external_watermark: false,
    view_once: false,
    view_once_opened_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("DM pics & videos privacy, View Once, viewer, and actions", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.profilesResult = { data: null, error: null };
    mocks.followsQueue = [];
    mocks.rpcMock.mockReset();
    mocks.storageCreateSignedUrl.mockReset();
    mocks.prepareWatermarkedFileMock.mockReset();
    mocks.saveFileToDiskMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("blocks strangers from sending pics/videos when allow_messages_from_everyone is OFF", async () => {
    mocks.profilesResult = {
      data: { id: "user-2", handle: "stranger", allow_messages_from_everyone: false },
      error: null,
    };
    // The sender does not follow this recipient.
    mocks.followsQueue = [{ data: null }];

    const perm = await checkDmMediaPermission({
      myUserId: "user-1",
      myHandle: "alice",
      targetHandle: "stranger",
    });

    expect(perm.allowed).toBe(false);
    expect(perm.isFollower).toBe(false);
    expect(perm.allowEveryone).toBe(false);
    expect(perm.reason).toContain("Follow @stranger");
  });

  it("allows pics/videos from a follower even when allow_messages_from_everyone is OFF", async () => {
    mocks.profilesResult = {
      data: { id: "user-2", handle: "bob", allow_messages_from_everyone: false },
      error: null,
    };
    mocks.followsQueue = [{ data: { id: "f1" } }];

    const perm = await checkDmMediaPermission({
      myUserId: "user-1",
      myHandle: "alice",
      targetHandle: "bob",
    });

    expect(perm.allowed).toBe(true);
    expect(perm.isFollower).toBe(true);
  });

  it("allows pics/videos from non-mutual users when allow_messages_from_everyone is ON", async () => {
    mocks.profilesResult = {
      data: { id: "user-2", handle: "creator", allow_messages_from_everyone: true },
      error: null,
    };

    const perm = await checkDmMediaPermission({
      myUserId: "user-1",
      myHandle: "alice",
      targetHandle: "creator",
    });

    expect(perm.allowed).toBe(true);
    expect(perm.allowEveryone).toBe(true);
  });

  it("opens a View Once message once and permanently marks it expired afterwards", async () => {
    const msg = makeMsg({
      id: "dm-once-1",
      view_once: true,
      media_url: "https://cdn.example.com/secret.jpg",
      media_type: "image",
    });

    mocks.rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        media_url: "https://cdn.example.com/secret.jpg",
        media_type: "image",
      },
      error: null,
    });

    const first = await openViewOnceMedia({ msg, myHandle: "alice" });
    expect(first.ok).toBe(true);
    expect(first.resolvedUrl).toBe("https://cdn.example.com/secret.jpg");
    expect(isViewOnceExpired(msg)).toBe(true);

    const second = await openViewOnceMedia({ msg, myHandle: "alice" });
    expect(second.ok).toBe(false);
    expect(second.expired).toBe(true);
  });

  it("renders + attachment menu options (Camera, Photo Library, Video, GIF, Coolerup Video) and View Once switch", () => {
    const onToggleViewOnce = vi.fn();
    render(
      <DmAttachmentSheet
        open={true}
        onClose={vi.fn()}
        onPickFile={vi.fn()}
        onOpenGif={vi.fn()}
        onPickCoolerupVideo={vi.fn()}
        viewOnce={false}
        onToggleViewOnce={onToggleViewOnce}
        permission={{
          allowed: true,
          isFollower: true,
          allowEveryone: false,
          recipientId: "user-2",
          recipientHandle: "bob",
        }}
        uploading={false}
      />,
    );

    expect(screen.getByRole("button", { name: /Camera/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Photo Library/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Video$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^GIF$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Coolerup Video/i })).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: /View Once/i });
    fireEvent.click(toggle);
    expect(onToggleViewOnce).toHaveBeenCalledTimes(1);
  });

  it("supports swiping between full-screen media and toggling pause & mute on videos", () => {
    const { container } = render(
      <DmMediaLightbox
        initialIndex={0}
        onClose={vi.fn()}
        items={[
          {
            id: "1",
            url: "https://cdn.example.com/clip.mp4",
            mediaType: "video",
            fromUsername: "bob",
          },
          {
            id: "2",
            url: "https://cdn.example.com/pic2.jpg",
            mediaType: "image",
            fromUsername: "alice",
          },
        ]}
      />,
    );

    const videoEl = container.querySelector("video") as HTMLVideoElement;
    expect(videoEl).toBeTruthy();
    expect(videoEl.muted).toBe(false); // plays with sound

    const pauseBtn = screen.getByRole("button", { name: /Pause video/i });
    const muteBtn = screen.getByRole("button", { name: /Mute video/i });
    expect(pauseBtn).toBeInTheDocument();
    expect(muteBtn).toBeInTheDocument();

    fireEvent.click(muteBtn);
    expect(videoEl.muted).toBe(true);
    expect(screen.getByRole("button", { name: /Unmute video/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByAltText("Photo from @alice")).toBeInTheDocument();
  });

  it("renders Save, Forward, Delete, Report in the long-press action sheet", () => {
    render(
      <DmMediaActionSheet
        msg={makeMsg()}
        resolvedUrl="https://cdn.example.com/photo.jpg"
        myUserId="user-1"
        myHandle="alice"
        recentRecipients={["charlie"]}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Forward/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report/i })).toBeInTheDocument();
  });

  it("routes saved DM videos through Smart Watermark prepareWatermarkedFile", async () => {
    const fakeBlob = new Blob(["video-bytes"], { type: "video/mp4" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(fakeBlob, { status: 200 }));
    const watermarkedFile = new File(["wm-bytes"], "coolerup-dm-v1.mp4", {
      type: "video/mp4",
    });
    mocks.prepareWatermarkedFileMock.mockResolvedValueOnce(watermarkedFile);

    await saveDmMediaToDevice({
      msg: makeMsg({
        id: "v1",
        media_type: "video",
        media_url: "https://cdn.example.com/v1.mp4",
      }),
    });

    expect(mocks.prepareWatermarkedFileMock).toHaveBeenCalledTimes(1);
    expect(mocks.saveFileToDiskMock).toHaveBeenCalledWith(watermarkedFile);
    fetchSpy.mockRestore();
  });

  it("loads messages using wildcard select and preserves media when DB lacks new DM columns", async () => {
    const encodedMessage = withLegacyDmMediaMessage("Check this out", {
      mediaUrl: "storage:dm/user-1/clip.mp4",
      mediaType: "video",
      viewOnce: true,
    });

    const decoded = normalizeDmRow({
      id: "legacy-1",
      from_username: "alice",
      to_username: "bob",
      message: encodedMessage,
      created_at: new Date().toISOString(),
    });

    expect(decoded.message).toBe("Check this out");
    expect(decoded.media_url).toBe("storage:dm/user-1/clip.mp4");
    expect(decoded.media_type).toBe("video");
    expect(decoded.view_once).toBe(true);

    await expect(fetchDirectMessages()).resolves.toEqual([]);
  });
});
