import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  Eye,
  Gamepad2,
  Loader2,
  LogOut,
  Search,
  Tv,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildTwitchChatEmbedUrl,
  buildTwitchParentParams,
  buildTwitchPlayerEmbedUrl,
  FEATURED_TWITCH_CHANNELS,
  formatTwitchThumbnail,
  formatViewerCount,
  normalizeTwitchChannel,
  type TwitchGame,
  type TwitchStream,
  type TwitchStreamsResponse,
  type TwitchUser,
} from "@/lib/twitch";

const FOLLOW_STORAGE_KEY = "coolerup:twitch-follows";

function readStoredFollows(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLLOW_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeStoredFollows(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors in private mode.
  }
}

export function TwitchPanel() {
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<TwitchGame | null>(null);
  const [streams, setStreams] = useState<TwitchStream[]>([]);
  const [games, setGames] = useState<TwitchGame[]>([]);
  const [configured, setConfigured] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [twitchUser, setTwitchUser] = useState<TwitchUser | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [activeStream, setActiveStream] = useState<TwitchStream | null>(null);
  const [follows, setFollows] = useState<Record<string, boolean>>(() =>
    typeof window !== "undefined" ? readStoredFollows() : {},
  );
  const [followBusy, setFollowBusy] = useState(false);

  const parents = useMemo(() => {
    if (typeof window === "undefined") return ["localhost"];
    return buildTwitchParentParams(window.location.hostname, window.location.ancestorOrigins);
  }, []);

  const loadCurrentUser = useCallback(async () => {
    try {
      const res = await fetch("/api/twitch/me");
      if (!res.ok) return;
      const data = (await res.json()) as { user?: TwitchUser | null };
      setTwitchUser(data.user ?? null);
    } catch {
      // Ignore network errors while checking session.
    }
  }, []);

  useEffect(() => {
    void loadCurrentUser();
  }, [loadCurrentUser]);

  // Listen for postMessage completion from the Twitch OAuth popup window.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin;
      const sameOrigin = typeof window !== "undefined" && origin === window.location.origin;
      if (!sameOrigin && !origin.endsWith(".run.app") && !origin.includes("localhost")) {
        return;
      }
      const data = event.data as
        { type?: string; provider?: string; user?: TwitchUser; error?: string } | undefined;
      if (data?.provider !== "twitch") return;

      if (data.type === "OAUTH_AUTH_SUCCESS" && data.user) {
        setTwitchUser(data.user);
        setConnecting(false);
        toast.success(`Connected Twitch as ${data.user.display_name}`);
      } else if (data.type === "OAUTH_AUTH_ERROR") {
        setConnecting(false);
        toast.error(data.error || "Twitch sign-in was canceled");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const loadDirectory = useCallback(
    async (opts: { q?: string | undefined; gameId?: string | undefined }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (opts.q) params.set("q", opts.q);
        if (opts.gameId) params.set("gameId", opts.gameId);
        const qs = params.toString();
        const res = await fetch(`/api/twitch/streams${qs ? `?${qs}` : ""}`);
        if (!res.ok) {
          throw new Error("Could not load Twitch streams right now.");
        }
        const data = (await res.json()) as TwitchStreamsResponse;
        setConfigured(data.configured);
        setStreams(data.streams ?? []);
        if (data.games && data.games.length > 0) {
          setGames(data.games);
        } else if (opts.q) {
          setGames([]);
        }
        if (data.error) setError(data.error);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Twitch streams.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadDirectory({
      q: appliedQuery || undefined,
      gameId: !appliedQuery && selectedGame ? selectedGame.id : undefined,
    });
  }, [appliedQuery, selectedGame, loadDirectory]);

  // Check real Helix follow state when opening a stream while connected to Twitch.
  useEffect(() => {
    if (!activeStream || !twitchUser || !activeStream.user_id) return;
    let alive = true;
    fetch(`/api/twitch/follow?broadcasterId=${encodeURIComponent(activeStream.user_id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { connected?: boolean; following?: boolean } | null) => {
        if (!alive || !data?.connected) return;
        const login = activeStream.user_login.toLowerCase();
        setFollows((prev) => {
          const next = { ...prev, [login]: Boolean(data.following) };
          writeStoredFollows(next);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeStream, twitchUser]);

  const handleConnectTwitch = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/twitch/auth/url");
      const data = (await res.json()) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        setConnecting(false);
        // Connecting is optional: streams and chat play fine without it.
        toast("Twitch sign-in isn't available right now. You can still watch streams and chat.");
        return;
      }

      const popup = window.open(
        data.url,
        "twitch_oauth",
        "width=520,height=720,menubar=no,toolbar=no,status=no",
      );
      if (!popup) {
        setConnecting(false);
        toast.error("Please allow popups for this site to connect your Twitch account.");
        return;
      }

      // Reset connecting state if user closes popup manually before completing OAuth.
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          setConnecting(false);
        }
      }, 600);
    } catch {
      setConnecting(false);
      toast.error("Couldn't open Twitch sign-in.");
    }
  }, [connecting]);

  const handleDisconnectTwitch = async () => {
    try {
      await fetch("/api/twitch/me", { method: "DELETE" });
    } catch {
      // Clear local UI state regardless.
    }
    setTwitchUser(null);
    toast.success("Disconnected Twitch account");
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSelectedGame(null);
    setAppliedQuery(searchInput.trim());
  };

  const openDirectChannel = (rawChannel: string) => {
    const login = normalizeTwitchChannel(rawChannel);
    if (!login) return;
    setActiveStream({
      id: `channel-${login}`,
      user_id: "",
      user_login: login,
      user_name: login,
      game_id: "",
      game_name: "Live on Twitch",
      title: `${login}'s Live Stream`,
      viewer_count: 0,
      thumbnail_url: "",
    });
  };

  const toggleFollow = async (stream: TwitchStream) => {
    if (followBusy) return;
    const key = stream.user_login.toLowerCase();
    const nextValue = !follows[key];
    setFollowBusy(true);
    setFollows((prev) => {
      const next = { ...prev, [key]: nextValue };
      writeStoredFollows(next);
      return next;
    });
    try {
      // Without a connected Twitch account the follow is just saved on this device.
      if (twitchUser && stream.user_id)
        await fetch("/api/twitch/follow", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            broadcasterId: stream.user_id,
            broadcasterLogin: stream.user_login,
            follow: nextValue,
          }),
        });
      toast.success(nextValue ? `Following ${stream.user_name}` : `Unfollowed ${stream.user_name}`);
    } catch {
      toast.success(nextValue ? `Following ${stream.user_name}` : `Unfollowed ${stream.user_name}`);
    } finally {
      setFollowBusy(false);
    }
  };

  const directSearchChannel = normalizeTwitchChannel(searchInput);
  const isFollowingActive = activeStream
    ? Boolean(follows[activeStream.user_login.toLowerCase()])
    : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-black text-white">
      {/* Header + Connect Twitch OAuth */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FE2C55] text-white">
            <Tv className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-extrabold leading-tight text-white">Twitch</h2>
            <p className="text-[11px] text-white/60">Watch live streams inside Coolerup</p>
          </div>
        </div>

        {twitchUser ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white">
              {twitchUser.profile_image_url && (
                <img
                  src={twitchUser.profile_image_url}
                  alt={twitchUser.display_name}
                  className="h-5 w-5 rounded-full object-cover"
                />
              )}
              <span className="max-w-[110px] truncate">{twitchUser.display_name}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleDisconnectTwitch()}
              aria-label="Disconnect Twitch"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void handleConnectTwitch()}
            disabled={connecting}
            className="flex items-center gap-1.5 rounded-full bg-[#FE2C55] px-3.5 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {connecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            Connect Twitch
          </button>
        )}
      </div>

      {/* Scrollable Twitch Directory */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-3">
        {/* Search bar at top */}
        <form onSubmit={handleSearchSubmit} className="mb-5 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => {
                const next = e.target.value;
                setSearchInput(next);
                if (!next.trim() && appliedQuery) {
                  setAppliedQuery("");
                }
              }}
              placeholder="Search live streams, games, or channel..."
              aria-label="Search Twitch"
              className="h-10 w-full rounded-full border border-white/15 bg-white/10 pl-9 pr-9 text-sm text-white placeholder:text-white/50 focus:border-[#FE2C55] focus:outline-none"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchInput("");
                  setAppliedQuery("");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="h-10 shrink-0 rounded-full bg-[#FE2C55] px-4 text-xs font-bold text-white transition hover:brightness-110"
          >
            Search
          </button>
        </form>

        {/* Direct channel shortcut when searching a streamer name */}
        {directSearchChannel && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/5 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">Watch @{directSearchChannel}</p>
              <p className="text-xs text-white/60">
                Open Twitch player & live chat inside Coolerup
              </p>
            </div>
            <button
              type="button"
              onClick={() => openDirectChannel(directSearchChannel)}
              className="shrink-0 rounded-full bg-[#FE2C55] px-3.5 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
            >
              Watch Live
            </button>
          </div>
        )}

        {/* LIVE NOW row */}
        <section aria-labelledby="twitch-live-now-heading" className="mb-6">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FE2C55] opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#FE2C55]" />
              </span>
              <h3
                id="twitch-live-now-heading"
                className="text-xs font-extrabold uppercase tracking-[0.16em] text-white"
              >
                LIVE NOW
              </h3>
              {selectedGame && !appliedQuery && (
                <span className="rounded-full bg-[#FE2C55]/20 px-2.5 py-0.5 text-[11px] font-semibold text-[#FE2C55]">
                  {selectedGame.name}
                </span>
              )}
            </div>
            {selectedGame && (
              <button
                type="button"
                onClick={() => setSelectedGame(null)}
                className="text-xs font-semibold text-white/70 hover:text-white"
              >
                All games
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {Array.from({ length: 3 }, (_, idx) => (
                <div
                  key={idx}
                  className="w-60 shrink-0 animate-pulse rounded-2xl border border-white/10 bg-white/5 p-2"
                >
                  <div className="aspect-video w-full rounded-xl bg-white/10" />
                  <div className="mt-2 h-3.5 w-2/3 rounded bg-white/10" />
                  <div className="mt-1.5 h-3 w-1/2 rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : !configured ? (
            <div>
              <p className="mb-2 text-xs text-white/60">
                Pick a channel to watch with Twitch&apos;s public player, or search any channel name
                above. No login needed.
              </p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {FEATURED_TWITCH_CHANNELS.map((c) => (
                  <button
                    key={c.login}
                    type="button"
                    onClick={() => openDirectChannel(c.login)}
                    className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-2.5 text-left transition hover:border-[#FE2C55]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FE2C55] text-xs font-black uppercase text-white">
                      {c.name.slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-white">{c.name}</span>
                      <span className="block text-[11px] font-semibold text-[#FE2C55]">Watch</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-sm text-white/70">
              {error}
            </div>
          ) : streams.length === 0 ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-sm text-white/70">
              {appliedQuery
                ? `No live streams found for "${appliedQuery}".`
                : "No live streams found right now."}
            </div>
          ) : (
            <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto pb-2 touch-pan-x">
              {streams.map((stream) => (
                <button
                  key={stream.id}
                  type="button"
                  onClick={() => setActiveStream(stream)}
                  className="group w-64 shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition hover:border-[#FE2C55]"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
                    {stream.thumbnail_url ? (
                      <img
                        src={formatTwitchThumbnail(stream.thumbnail_url, 440, 248)}
                        alt={stream.title}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-white/40">
                        <Tv className="h-8 w-8" />
                      </div>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-[#FE2C55] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                      LIVE
                    </span>
                    <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/80 px-2 py-0.5 text-[11px] font-bold text-white">
                      <Eye className="h-3 w-3 text-[#FE2C55]" />
                      {formatViewerCount(stream.viewer_count)}
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-sm font-bold text-white">{stream.user_name}</p>
                    <p className="truncate text-xs text-white/70">{stream.title}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-[#FE2C55]">
                      {stream.game_name || "Just Chatting"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* BROWSE BY GAME row (needs the Twitch API, so hidden in embed-only mode) */}
        {configured && (
          <section aria-labelledby="twitch-browse-games-heading">
            <div className="mb-2.5 flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-[#FE2C55]" />
              <h3
                id="twitch-browse-games-heading"
                className="text-xs font-extrabold uppercase tracking-[0.16em] text-white"
              >
                BROWSE BY GAME
              </h3>
            </div>

            {loading ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {Array.from({ length: 4 }, (_, idx) => (
                  <div
                    key={idx}
                    className="w-28 shrink-0 animate-pulse rounded-xl border border-white/10 bg-white/5 p-1.5"
                  >
                    <div className="aspect-[3/4] w-full rounded-lg bg-white/10" />
                    <div className="mt-2 h-3 w-4/5 rounded bg-white/10" />
                  </div>
                ))}
              </div>
            ) : games.length === 0 ? (
              <p className="text-xs text-white/50">No games matching your filter.</p>
            ) : (
              <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto pb-2 touch-pan-x">
                {games.map((game) => {
                  const selected = selectedGame?.id === game.id;
                  return (
                    <button
                      key={game.id}
                      type="button"
                      onClick={() => {
                        setAppliedQuery("");
                        setSearchInput("");
                        setSelectedGame((curr) => (curr?.id === game.id ? null : game));
                      }}
                      aria-pressed={selected}
                      className={`w-28 shrink-0 snap-start overflow-hidden rounded-xl border p-1.5 text-left transition ${
                        selected
                          ? "border-[#FE2C55] bg-[#FE2C55]/15"
                          : "border-white/10 bg-white/5 hover:border-white/30"
                      }`}
                    >
                      <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-zinc-900">
                        {game.box_art_url ? (
                          <img
                            src={formatTwitchThumbnail(game.box_art_url, 285, 380)}
                            alt={game.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/40">
                            <Gamepad2 className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs font-bold leading-tight text-white">
                        {game.name}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Full-screen Twitch Embed Player + Live Chat overlay inside Coolerup */}
      {activeStream && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${activeStream.user_name} Twitch player`}
          className="fixed inset-0 z-50 flex h-dvh flex-col bg-black text-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
        >
          {/* Top Bar */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black px-3 py-2">
            <button
              type="button"
              onClick={() => setActiveStream(null)}
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/20"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            <div className="flex items-center gap-2">
              <span className="rounded bg-[#FE2C55] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                LIVE
              </span>
              {activeStream.viewer_count > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold text-white/80">
                  <Eye className="h-3.5 w-3.5 text-[#FE2C55]" />
                  {formatViewerCount(activeStream.viewer_count)}
                </span>
              )}
            </div>

            {twitchUser ? (
              <span className="max-w-[120px] truncate rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white">
                @{twitchUser.login}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleConnectTwitch()}
                disabled={connecting}
                className="rounded-full bg-[#FE2C55] px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {connecting ? "Connecting..." : "Connect Twitch"}
              </button>
            )}
          </div>

          {/* Twitch Embed Player */}
          <div className="aspect-video w-full max-h-[38dvh] shrink-0 bg-black">
            <iframe
              src={buildTwitchPlayerEmbedUrl(activeStream.user_login, parents)}
              title={`${activeStream.user_name} live video player`}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>

          {/* Streamer Name, Title, Follow button */}
          <div className="shrink-0 border-y border-white/10 bg-black px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {activeStream.avatar_url ? (
                  <img
                    src={activeStream.avatar_url}
                    alt={activeStream.user_name}
                    className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-[#FE2C55]"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FE2C55] text-xs font-black uppercase text-white">
                    {activeStream.user_name.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-white">
                    {activeStream.user_name}
                  </p>
                  <p className="truncate text-[11px] font-semibold text-[#FE2C55]">
                    {activeStream.game_name || "Live on Twitch"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void toggleFollow(activeStream)}
                disabled={followBusy}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition ${
                  isFollowingActive
                    ? "border border-white/25 bg-white/15 text-white hover:bg-white/20"
                    : "bg-[#FE2C55] text-white hover:brightness-110"
                }`}
              >
                {isFollowingActive ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Following
                  </>
                ) : (
                  "Follow"
                )}
              </button>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs text-white/85">{activeStream.title}</p>
          </div>

          {/* Connect Twitch banner above chat if signed out */}
          {!twitchUser && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-zinc-950 px-3.5 py-2">
              <p className="text-[11px] text-white/75">
                Optional: connect Twitch to sync follows. You can also log in inside the chat below.
              </p>
              <button
                type="button"
                onClick={() => void handleConnectTwitch()}
                disabled={connecting}
                className="shrink-0 rounded-full bg-[#FE2C55] px-3 py-1 text-[11px] font-bold text-white"
              >
                Connect Twitch
              </button>
            </div>
          )}

          {/* Live Chat below */}
          <div className="flex min-h-0 flex-1 flex-col bg-black">
            <iframe
              src={buildTwitchChatEmbedUrl(activeStream.user_login, parents)}
              title={`${activeStream.user_name} live chat`}
              className="min-h-0 w-full flex-1 border-0 bg-black"
            />
          </div>
        </div>
      )}
    </div>
  );
}
