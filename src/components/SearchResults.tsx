import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, Loader2, Music2, Pause, Play, Radio, SearchX, Hash } from "lucide-react";
import { SearchAvatar } from "@/components/SearchAvatar";
import { formatCount, isImageUrl, parseCaption, resolveVideoUrl, type Video } from "@/lib/loop";
import { soundAudioUrl, type Sound } from "@/lib/sounds";
import type { LiveHost } from "@/lib/liveDirectory";
import {
  SEARCH_TABS,
  type SearchHashtag,
  type SearchResultsBundle,
  type SearchTab,
  type SearchUser,
} from "@/lib/search";

type Props = {
  query: string;
  tab: SearchTab;
  onTabChange: (tab: SearchTab) => void;
  results: SearchResultsBundle;
  loading: boolean;
  liveHosts: LiveHost[];
  onOpenVideo: (video: Video) => void;
  onOpenUser: (user: SearchUser) => void;
  onOpenSound: (sound: Sound) => void;
  onOpenHashtag: (tag: string) => void;
  onWatchLive: (host: LiveHost) => void;
  /** Handles of people the viewer already follows. */
  following: Set<string>;
  onToggleFollow: (user: SearchUser) => void;
  isSignedIn: boolean;
};

/** Lazy thumbnail: resolves the storage URL only once the tile scrolls near. */
function Thumb({ video }: { video: Video }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let alive = true;
    void resolveVideoUrl(video.video_url).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [near, video.video_url]);

  const caption = parseCaption(video.caption).text;
  const image =
    isImageUrl(video.video_url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(video.video_url);

  return (
    <div ref={boxRef} className="h-full w-full bg-[#1c1c1c]">
      {src ? (
        image ? (
          <img src={src} alt={caption} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <video
            src={`${src}#t=0.5`}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )
      ) : null}
    </div>
  );
}

function VideoTile({ video, onOpen }: { video: Video; onOpen: (video: Video) => void }) {
  const caption = parseCaption(video.caption).text;
  return (
    <button
      type="button"
      onClick={() => onOpen(video)}
      className="group relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-[#1c1c1c] text-left"
      aria-label={caption || `Video by ${video.username}`}
    >
      <Thumb video={video} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent p-2 pt-8">
        <p className="flex items-center gap-1 text-[11px] font-semibold text-white/90">
          <Heart className="h-3 w-3 fill-white" aria-hidden /> {formatCount(video.likes_count ?? 0)}
        </p>
        {caption && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-white/80">{caption}</p>
        )}
      </div>
    </button>
  );
}

function UserRow({
  user,
  following,
  onOpen,
  onToggleFollow,
  isSignedIn,
}: {
  user: SearchUser;
  following: boolean;
  onOpen: (user: SearchUser) => void;
  onToggleFollow: (user: SearchUser) => void;
  isSignedIn: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <button
        type="button"
        onClick={() => onOpen(user)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <SearchAvatar name={user.handle} avatarUrl={user.avatar_url} size={48} />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-bold text-white">@{user.handle}</span>
          <span className="block truncate text-[12px] text-white/45">
            {user.display_name || "Coolerup creator"}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onToggleFollow(user)}
        title={isSignedIn ? undefined : "Sign in to follow"}
        className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-bold transition active:scale-95 ${
          following
            ? "border border-white/20 bg-transparent text-white/80"
            : "bg-[#fe2c55] text-white"
        }`}
      >
        {following ? "Following" : "Follow"}
      </button>
    </div>
  );
}

function SoundRow({ sound, onOpen }: { sound: Sound; onOpen: (sound: Sound) => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const toggle = async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!audioRef.current) {
      const url = await soundAudioUrl(sound);
      if (!url) return;
      const audio = new Audio(url);
      audio.onended = () => setPlaying(false);
      audioRef.current = audio;
    }
    try {
      await audioRef.current.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? `Pause ${sound.title}` : `Play ${sound.title}`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#fe2c55] to-[#7a1bff] text-white transition active:scale-95"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button type="button" onClick={() => onOpen(sound)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] font-bold text-white">{sound.title}</span>
        <span className="block truncate text-[12px] text-white/45">
          <Music2 className="mr-1 inline h-3 w-3" aria-hidden />
          @{sound.creator_username} · {formatCount(sound.uses_count ?? 0)} videos
        </span>
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 mt-5 text-[15px] font-bold text-white first:mt-0">{children}</h3>;
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <SearchX className="mb-3 h-10 w-10 text-white/25" aria-hidden />
      <p className="text-[15px] font-bold text-white">No results found</p>
      <p className="mt-1 text-[13px] text-white/45">Try a different search than “{query}”.</p>
    </div>
  );
}

function HashtagRow({ tag, onOpen }: { tag: SearchHashtag; onOpen: (tag: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(tag.tag)}
      className="flex w-full items-center gap-3 py-3 text-left"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2a2a2a] text-white">
        <Hash className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold text-white">#{tag.tag}</span>
        <span className="block text-[12px] text-white/45">
          {formatCount(tag.videos)} {tag.videos === 1 ? "video" : "videos"}
        </span>
      </span>
    </button>
  );
}

function LiveRow({ host, onWatch }: { host: LiveHost; onWatch: (host: LiveHost) => void }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <button
        type="button"
        onClick={() => onWatch(host)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="relative">
          <SearchAvatar name={host.username} avatarUrl={null} size={48} />
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-[#fe2c55] px-1 text-[8px] font-black uppercase leading-3 text-white">
            Live
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-bold text-white">@{host.username}</span>
          <span className="block truncate text-[12px] text-white/45">{host.title}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onWatch(host)}
        className="flex shrink-0 items-center gap-1 rounded-full bg-[#fe2c55] px-3.5 py-1.5 text-[13px] font-bold text-white transition active:scale-95"
      >
        <Radio className="h-3.5 w-3.5" /> Watch
      </button>
    </div>
  );
}

/**
 * The six-tab TikTok-style results surface. Tabs can be tapped or swiped
 * left/right; each tab renders its own slice of the result bundle.
 */
export function SearchResults({
  query,
  tab,
  onTabChange,
  results,
  loading,
  liveHosts,
  onOpenVideo,
  onOpenUser,
  onOpenSound,
  onOpenHashtag,
  onWatchLive,
  following,
  onToggleFollow,
  isSignedIn,
}: Props) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const tabIndex = SEARCH_TABS.findIndex((entry) => entry.id === tab);

  const swipe = (direction: 1 | -1) => {
    const next = SEARCH_TABS[tabIndex + direction];
    if (next) onTabChange(next.id);
  };

  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    swipe(dx < 0 ? 1 : -1);
  };

  const { videos, users, sounds, hashtags } = results;

  const topVideos = useMemo(() => videos.slice(0, 6), [videos]);
  const topUsers = useMemo(() => users.slice(0, 3), [users]);
  const topSounds = useMemo(() => sounds.slice(0, 3), [sounds]);
  const topHashtags = useMemo(() => hashtags.slice(0, 4), [hashtags]);

  const nothing =
    !loading &&
    videos.length === 0 &&
    users.length === 0 &&
    sounds.length === 0 &&
    hashtags.length === 0 &&
    liveHosts.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="search-results">
      <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-2">
        {SEARCH_TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onTabChange(entry.id)}
              className={`relative shrink-0 px-3 py-2.5 text-[14px] font-semibold transition ${
                active ? "text-white" : "text-white/45 hover:text-white/70"
              }`}
            >
              {entry.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[#fe2c55]" />
              )}
            </button>
          );
        })}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {loading && (
          <div className="flex items-center justify-center py-16 text-white/50">
            <Loader2 className="h-6 w-6 animate-spin" aria-label="Searching" />
          </div>
        )}

        {!loading && nothing && <EmptyState query={query} />}

        {!loading && !nothing && tab === "top" && (
          <div className="space-y-1">
            {topUsers.length > 0 && (
              <section>
                <SectionTitle>Users</SectionTitle>
                <div className="divide-y divide-white/5">
                  {topUsers.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      following={following.has(user.handle.toLowerCase())}
                      onOpen={onOpenUser}
                      onToggleFollow={onToggleFollow}
                      isSignedIn={isSignedIn}
                    />
                  ))}
                </div>
              </section>
            )}

            {topVideos.length > 0 && (
              <section>
                <SectionTitle>Videos</SectionTitle>
                <div className="grid grid-cols-2 gap-1.5">
                  {topVideos.map((video) => (
                    <VideoTile key={video.id} video={video} onOpen={onOpenVideo} />
                  ))}
                </div>
              </section>
            )}

            {topHashtags.length > 0 && (
              <section>
                <SectionTitle>Hashtags</SectionTitle>
                <div className="divide-y divide-white/5">
                  {topHashtags.map((tag) => (
                    <HashtagRow key={tag.tag} tag={tag} onOpen={onOpenHashtag} />
                  ))}
                </div>
              </section>
            )}

            {topSounds.length > 0 && (
              <section>
                <SectionTitle>Sounds</SectionTitle>
                <div className="divide-y divide-white/5">
                  {topSounds.map((sound) => (
                    <SoundRow key={sound.id} sound={sound} onOpen={onOpenSound} />
                  ))}
                </div>
              </section>
            )}

            {liveHosts.length > 0 && (
              <section>
                <SectionTitle>LIVE</SectionTitle>
                <div className="divide-y divide-white/5">
                  {liveHosts.slice(0, 3).map((host) => (
                    <LiveRow key={host.userId} host={host} onWatch={onWatchLive} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {!loading &&
          !nothing &&
          tab === "videos" &&
          (videos.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {videos.map((video) => (
                <VideoTile key={video.id} video={video} onOpen={onOpenVideo} />
              ))}
            </div>
          ) : (
            <EmptyState query={query} />
          ))}

        {!loading &&
          !nothing &&
          tab === "users" &&
          (users.length > 0 ? (
            <div className="divide-y divide-white/5">
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  following={following.has(user.handle.toLowerCase())}
                  onOpen={onOpenUser}
                  onToggleFollow={onToggleFollow}
                  isSignedIn={isSignedIn}
                />
              ))}
            </div>
          ) : (
            <EmptyState query={query} />
          ))}

        {!loading &&
          !nothing &&
          tab === "sounds" &&
          (sounds.length > 0 ? (
            <div className="divide-y divide-white/5">
              {sounds.map((sound) => (
                <SoundRow key={sound.id} sound={sound} onOpen={onOpenSound} />
              ))}
            </div>
          ) : (
            <EmptyState query={query} />
          ))}

        {!loading &&
          !nothing &&
          tab === "hashtags" &&
          (hashtags.length > 0 ? (
            <div className="divide-y divide-white/5">
              {hashtags.map((tag) => (
                <HashtagRow key={tag.tag} tag={tag} onOpen={onOpenHashtag} />
              ))}
            </div>
          ) : (
            <EmptyState query={query} />
          ))}

        {!loading &&
          !nothing &&
          tab === "live" &&
          (liveHosts.length > 0 ? (
            <div className="divide-y divide-white/5">
              {liveHosts.map((host) => (
                <LiveRow key={host.userId} host={host} onWatch={onWatchLive} />
              ))}
            </div>
          ) : (
            <EmptyState query={query} />
          ))}
      </div>
    </div>
  );
}
