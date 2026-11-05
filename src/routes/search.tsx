import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { TrendingSearches } from "@/components/TrendingSearches";
import { VideoCard } from "@/components/VideoCard";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { followUser, unfollowUser } from "@/lib/follow";
import { fetchMyLikes } from "@/lib/loop";
import type { Video } from "@/lib/loop";
import { useLiveDirectory } from "@/lib/liveDirectory";
import {
  filterLiveHosts,
  isSearchable,
  normalizeQuery,
  searchHashtags,
  searchSounds,
  searchUsers,
  searchVideos,
  suggestedUsers,
  useDebouncedValue,
  useSearchHistory,
  type SearchResultsBundle,
  type SearchTab,
  type SearchUser,
} from "@/lib/search";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search — Coolerup" },
      {
        name: "description",
        content:
          "Search Coolerup for videos, creators, sounds, hashtags and LIVE streams — all in one place.",
      },
    ],
  }),
  component: SearchPage,
});

const EMPTY: SearchResultsBundle = { videos: [], users: [], sounds: [], hashtags: [] };

function SearchPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("top");
  const [results, setResults] = useState<SearchResultsBundle>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchUser[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());

  // Full-screen video viewer opened from a result tile.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const debounced = useDebouncedValue(query, 300);
  const term = normalizeQuery(debounced);
  const searching = isSearchable(term);

  const history = useSearchHistory(auth.user?.id ?? null);

  const { hosts } = useLiveDirectory({ enabled: searching, key: auth.user?.id ?? null });
  const liveHosts = useMemo(
    () => (searching ? filterLiveHosts(hosts, term) : []),
    [hosts, searching, term],
  );

  // "You may like" people, loaded once.
  useEffect(() => {
    let alive = true;
    void suggestedUsers(6).then((rows) => {
      if (alive) setSuggestions(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Who the viewer already follows, so the Follow buttons start correct.
  useEffect(() => {
    const userId = auth.user?.id;
    if (!userId) {
      setFollowing(new Set());
      return;
    }
    let alive = true;
    void supabase
      .from("follows")
      .select("following_username")
      .eq("follower_id", userId)
      .then(({ data }) => {
        if (!alive) return;
        setFollowing(
          new Set((data ?? []).map((row) => String(row.following_username).toLowerCase())),
        );
      });
    return () => {
      alive = false;
    };
  }, [auth.user?.id]);

  // The actual search. Every tab is fed from one parallel fetch so switching
  // tabs is instant and never re-queries.
  useEffect(() => {
    if (!searching) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void Promise.all([
      searchVideos(term, 48),
      searchUsers(term, 30),
      searchSounds(term, 20),
      searchHashtags(term, 20),
    ])
      .then(([videos, users, sounds, hashtags]) => {
        if (!alive) return;
        setResults({ videos, users, sounds, hashtags });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [searching, term]);

  // Likes for the viewer.
  useEffect(() => {
    void fetchMyLikes()
      .then(setLikedIds)
      .catch(() => {});
  }, [viewIndex !== null]);

  // Scroll the viewer to the tapped tile.
  useEffect(() => {
    if (viewIndex === null) return;
    const el = viewerRef.current;
    const child = el?.children[viewIndex] as HTMLElement | undefined;
    if (el && child) el.scrollTop = child.offsetTop;
  }, [viewIndex]);

  const recordSearch = useCallback(
    (value: string) => {
      const clean = normalizeQuery(value);
      if (!clean) return;
      setQuery(clean);
      setTab("top");
      void history.add(clean);
    },
    [history],
  );

  const pick = useCallback(
    (value: string) => {
      recordSearch(value);
    },
    [recordSearch],
  );

  const back = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/" });
  }, [navigate]);

  const openVideo = useCallback(
    (video: Video) => {
      const index = results.videos.findIndex((row) => row.id === video.id);
      setViewIndex(index >= 0 ? index : 0);
    },
    [results.videos],
  );

  const openUser = useCallback(
    (user: SearchUser) => {
      void navigate({ to: "/u/$username", params: { username: user.handle } });
    },
    [navigate],
  );

  const openSound = useCallback(
    (sound: { id: string }) => {
      void navigate({ to: "/sound/$soundId", params: { soundId: sound.id } });
    },
    [navigate],
  );

  const openHashtag = useCallback(
    (tag: string) => {
      recordSearch(`#${tag}`);
      setTab("hashtags");
    },
    [recordSearch],
  );

  const watchLive = useCallback(
    (host: { userId: string; username: string }) => {
      void navigate({
        to: "/live",
        search: { host: host.userId, name: host.username },
      });
    },
    [navigate],
  );

  const toggleFollow = useCallback(
    async (user: SearchUser) => {
      if (!auth.user || !auth.handle) {
        void auth.signIn();
        return;
      }
      const key = user.handle.toLowerCase();
      const wasFollowing = following.has(key);
      setFollowing((prev) => {
        const next = new Set(prev);
        if (wasFollowing) next.delete(key);
        else next.add(key);
        return next;
      });
      const result = wasFollowing
        ? await unfollowUser({ followerId: auth.user.id, followingUsername: user.handle })
        : await followUser({
            followerId: auth.user.id,
            followerUsername: auth.handle,
            followingUsername: user.handle,
          });
      if (!result.ok) {
        setFollowing((prev) => {
          const next = new Set(prev);
          if (wasFollowing) next.add(key);
          else next.delete(key);
          return next;
        });
      }
    },
    [auth, following],
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-black text-white">
      <SearchBar
        value={query}
        onChange={setQuery}
        onSubmit={recordSearch}
        onBack={back}
        autoFocus
      />

      {!searching ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TrendingSearches
            recent={history.recent}
            suggestions={suggestions}
            onPick={pick}
            onDeleteRecent={(value) => void history.remove(value)}
            onClearRecent={() => void history.clear()}
          />
        </div>
      ) : (
        <SearchResults
          query={term}
          tab={tab}
          onTabChange={setTab}
          results={results}
          loading={loading}
          liveHosts={liveHosts}
          onOpenVideo={openVideo}
          onOpenUser={openUser}
          onOpenSound={openSound}
          onOpenHashtag={openHashtag}
          onWatchLive={watchLive}
          following={following}
          onToggleFollow={(user) => void toggleFollow(user)}
          isSignedIn={Boolean(auth.user)}
        />
      )}

      {viewIndex !== null && results.videos.length > 0 && (
        <div className="fixed inset-0 z-40 bg-black">
          <button
            type="button"
            onClick={() => setViewIndex(null)}
            aria-label="Close viewer"
            className="absolute left-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <div ref={viewerRef} className="h-dvh snap-y snap-mandatory overflow-y-scroll">
            {results.videos.map((video) => (
              <div key={video.id} className="h-dvh snap-start snap-always">
                <VideoCard
                  video={video}
                  liked={likedIds.has(video.id)}
                  muted={muted}
                  onToggleMute={() => setMuted((value) => !value)}
                  onLikeChange={(videoId, on) =>
                    setLikedIds((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(videoId);
                      else next.delete(videoId);
                      return next;
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
