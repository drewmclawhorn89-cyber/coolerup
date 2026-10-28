import { render, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the calling bug: signalling used to open a fresh Realtime
 * channel per signal and remove it immediately, which dropped every message
 * after the first. A real call sends an offer plus several ICE candidates, so
 * only the offer survived and the call never connected.
 */

type MockChannel = {
  topic: string;
  on: (type: string, filter: unknown, handler: (msg: { payload: unknown }) => void) => MockChannel;
  subscribe: (cb?: (status: string) => void) => MockChannel;
  send: (msg: unknown) => Promise<string>;
};

const state = vi.hoisted(() => ({
  channels: [] as {
    topic: string;
    handlers: ((msg: { payload: unknown }) => void)[];
    sends: unknown[];
    removed: boolean;
  }[],
  removeCalls: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const supabase = {
    channel: (topic: string) => {
      const entry = {
        topic,
        handlers: [] as ((msg: { payload: unknown }) => void)[],
        sends: [] as unknown[],
        removed: false,
      };
      state.channels.push(entry);
      const ch: MockChannel = {
        topic,
        on: (_type: string, _filter: unknown, handler: (msg: { payload: unknown }) => void) => {
          entry.handlers.push(handler);
          return ch;
        },
        subscribe: (cb?: (status: string) => void) => {
          // Supabase reports SUBSCRIBED asynchronously.
          setTimeout(() => cb?.("SUBSCRIBED"), 0);
          return ch;
        },
        send: async (msg: unknown) => {
          entry.sends.push(msg);
          return "ok";
        },
      };
      return ch;
    },
    removeChannel: async (ch: { topic?: string }) => {
      state.removeCalls.push(ch?.topic ?? "unknown");
      return "ok";
    },
    from: () => ({ insert: async () => ({ error: null }) }),
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  };
  return { supabase };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "me" },
    handle: "me",
    ready: true,
    signIn: vi.fn(),
  }),
}));

vi.mock("@/lib/push.functions", () => ({
  savePushSubscription: async () => ({}),
  sendCallPush: async () => ({}),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
  },
}));

// --- Fake WebRTC -----------------------------------------------------------
let candidateSeq = 0;

class FakePC {
  connectionState = "new";
  signalingState = "stable";
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  onicecandidate: ((e: { candidate: { toJSON: () => unknown } | null }) => void) | null = null;
  ontrack: ((e: { track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  addTrack() {}
  close() {
    this.signalingState = "closed";
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\nfake-offer" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0\r\nfake-answer" };
  }
  async setLocalDescription(desc: unknown) {
    this.localDescription = desc;
    this.signalingState = "have-local-offer";
    // Emit two ICE candidates the way a real connection does.
    for (let i = 0; i < 2; i++) {
      candidateSeq += 1;
      this.onicecandidate?.({
        candidate: { toJSON: () => ({ candidate: `candidate:${candidateSeq}`, sdpMid: "0" }) },
      });
    }
  }
  async setRemoteDescription(desc: unknown) {
    this.remoteDescription = desc;
  }
  async addIceCandidate() {}
}

const track = { kind: "audio", enabled: true, stop: () => {} };
const fakeStream = {
  getTracks: () => [track],
  getAudioTracks: () => [track],
  getVideoTracks: () => [],
};

beforeEach(() => {
  state.channels.length = 0;
  state.removeCalls.length = 0;
  candidateSeq = 0;
  const g = globalThis as unknown as Record<string, unknown>;
  g["RTCPeerConnection"] = FakePC;
  g["MediaStream"] = class {
    tracks: unknown[] = [];
    getTracks() {
      return this.tracks;
    }
    addTrack(t: unknown) {
      this.tracks.push(t);
    }
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => fakeStream },
  });
});

async function mountProvider() {
  const { CallProvider, useCall } = await import("@/lib/calls");
  let api: ReturnType<typeof useCall> | null = null;
  function Probe() {
    api = useCall();
    return null;
  }
  render(
    <CallProvider>
      <Probe />
    </CallProvider>,
  );
  await waitFor(() => expect(api).not.toBeNull());
  return () => api!;
}

describe("call signalling", () => {
  it("reuses one channel per peer and delivers the offer plus every ICE candidate", async () => {
    const get = await mountProvider();
    await act(async () => {
      await get().startCall("bob", "peer-1", false);
    });

    const peerChannels = state.channels.filter((c) => c.topic === "loop-call-peer-1");
    expect(peerChannels).toHaveLength(1);

    const sent = peerChannels[0]!.sends as { payload: { kind: string } }[];
    expect(sent.map((s) => s.payload.kind)).toEqual(["offer", "ice", "ice"]);
  });

  it("does not tear the signalling channel down mid-call", async () => {
    const get = await mountProvider();
    await act(async () => {
      await get().startCall("bob", "peer-1", false);
    });

    expect(state.removeCalls).not.toContain("loop-call-peer-1");
    expect(get().call.status).toBe("outgoing");
  });

  it("sends the hangup before releasing the channel", async () => {
    const get = await mountProvider();
    await act(async () => {
      await get().startCall("bob", "peer-1", false);
    });

    await act(async () => {
      get().endCall();
      await new Promise((r) => setTimeout(r, 20));
    });

    const peerChannel = state.channels.find((c) => c.topic === "loop-call-peer-1")!;
    const kinds = (peerChannel.sends as { payload: { kind: string } }[]).map((s) => s.payload.kind);
    expect(kinds.at(-1)).toBe("end");
    expect(state.removeCalls).toContain("loop-call-peer-1");
    expect(get().call.status).toBe("idle");
  });
});
