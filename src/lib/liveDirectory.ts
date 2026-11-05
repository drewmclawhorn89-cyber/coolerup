import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Presence channel every LIVE client joins.
 *
 * Hosts `track()` an entry while they are broadcasting, so anyone subscribed
 * sees the full "who is live right now" directory without hitting the database.
 * Both the LIVE tab and the in-room menu read from this same channel.
 */
export const LIVE_DIRECTORY_CHANNEL = "coolerup-live-directory";

export type LiveHost = {
  userId: string;
  username: string;
  title: string;
  /** Epoch ms the host went live; used to keep the list stable/ordered. */
  since: number;
};

/** Raw shape of one presence entry on the directory channel. */
type Presence = {
  userId?: string;
  username?: string;
  title?: string;
  since?: number;
  live?: boolean;
};

const FALLBACK_TITLE = "Live now";

/** Stable per-tab id so signed-out viewers still get a unique presence key. */
export const liveViewerId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Turns raw presence entries into a de-duplicated, oldest-first host list.
 * Entries that are not live (or are missing identity) are dropped.
 */
export function hostsFromPresence(entries: Presence[]): LiveHost[] {
  const unique = new Map<string, LiveHost>();
  entries
    .filter((entry) => entry.live && entry.userId && entry.username)
    .forEach((entry) => {
      unique.set(entry.userId!, {
        userId: entry.userId!,
        username: entry.username!,
        title: entry.title || FALLBACK_TITLE,
        since: entry.since || Date.now(),
      });
    });
  return [...unique.values()].sort((a, b) => a.since - b.since);
}

/**
 * One shared directory channel per page. Supabase returns the same channel for
 * the same topic, so every hook must reuse it instead of re-adding callbacks.
 */
type SharedDirectory = {
  channel: RealtimeChannel;
  refs: number;
  hosts: LiveHost[];
  subscribed: boolean;
  listeners: Set<(hosts: LiveHost[]) => void>;
  onReady: Set<() => void>;
};
let sharedDirectory: SharedDirectory | null = null;

function acquireDirectory(presenceKey: string): SharedDirectory {
  if (sharedDirectory) {
    sharedDirectory.refs += 1;
    return sharedDirectory;
  }
  const channel = supabase.channel(LIVE_DIRECTORY_CHANNEL, {
    config: { presence: { key: presenceKey } },
  });
  const shared: SharedDirectory = {
    channel,
    refs: 1,
    hosts: [],
    subscribed: false,
    listeners: new Set(),
    onReady: new Set(),
  };
  channel.on("presence", { event: "sync" }, () => {
    const entries = Object.values(channel.presenceState()).flat() as Presence[];
    shared.hosts = hostsFromPresence(entries);
    shared.listeners.forEach((fn) => fn(shared.hosts));
  });
  channel.subscribe((status: string) => {
    if (status !== "SUBSCRIBED") return;
    shared.subscribed = true;
    shared.onReady.forEach((fn) => fn());
    shared.onReady.clear();
  });
  sharedDirectory = shared;
  return shared;
}

function releaseDirectory(shared: SharedDirectory) {
  shared.refs -= 1;
  if (shared.refs > 0) return;
  if (sharedDirectory === shared) sharedDirectory = null;
  void supabase.removeChannel(shared.channel);
}

type DirectoryOptions = {
  /** Only stay subscribed while this is true. */
  enabled?: boolean;
  /** Presence key — usually the signed-in user id. */
  key?: string | null;
  /**
   * Set this while the local client is broadcasting. The hook announces the
   * host on the directory and keeps the title in sync as it changes.
   */
  host?: {
    userId?: string | null | undefined;
    username?: string | null | undefined;
    title?: string | null | undefined;
  } | null;
};

/**
 * Subscribes to the LIVE directory and returns everyone currently broadcasting.
 *
 * Pass `host` while broadcasting to publish this client; pass nothing to just
 * watch the directory.
 */
export function useLiveDirectory({ enabled = true, key, host }: DirectoryOptions = {}) {
  const [hosts, setHosts] = useState<LiveHost[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const fallbackKey = useRef(liveViewerId());

  const hostUserId = host?.userId ?? null;
  const hostUsername = host?.username ?? null;
  const hostTitle = host?.title ?? null;

  useEffect(() => {
    if (!enabled) return;
    const shared = acquireDirectory(key ?? fallbackKey.current);
    const channel = shared.channel;
    channelRef.current = channel;
    const listener = (next: LiveHost[]) => setHosts(next);
    shared.listeners.add(listener);
    listener(shared.hosts);

    const announce = () => {
      if (hostUserId && hostUsername) {
        void channel.track({
          userId: hostUserId,
          username: hostUsername,
          title: hostTitle?.trim() || FALLBACK_TITLE,
          since: Date.now(),
          live: true,
        });
      }
    };
    if (shared.subscribed) announce();
    else shared.onReady.add(announce);

    return () => {
      shared.onReady.delete(announce);
      shared.listeners.delete(listener);
      if (channelRef.current === channel) channelRef.current = null;
      if (hostUserId) void channel.untrack();
      releaseDirectory(shared);
    };
    // Title changes are pushed by the effect below so we don't re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, hostUserId, hostUsername]);

  // Keep the published title current without tearing down the channel.
  useEffect(() => {
    if (!hostUserId || !hostUsername) return;
    void channelRef.current?.track({
      userId: hostUserId,
      username: hostUsername,
      title: hostTitle?.trim() || FALLBACK_TITLE,
      since: Date.now(),
      live: true,
    });
  }, [hostUserId, hostUsername, hostTitle]);

  return { hosts, channel: channelRef };
}
