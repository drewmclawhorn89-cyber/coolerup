import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Music, Play, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { VideoCard } from "@/components/VideoCard";
import { RecordDialog } from "@/components/RecordDialog";
import { UploadDialog } from "@/components/UploadDialog";
import {
  fetchMyLikes,
  formatCount,
  isImageUrl,
  parseCaption,
  resolveVideoUrl,
  type Video,
} from "@/lib/loop";
import { formatUses, getSound, getSoundVideos, type Sound } from "@/lib/sounds";

export const Route = createFileRoute("/sound/$soundId")({
  component: SoundPage,
});

function Thumb({ url, caption }: { url: string; caption: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setNear(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let alive = true;
    void resolveVideoUrl(url).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [url, near]);

  if (!src) return <div ref={boxRef} className="h-full w-full" />;
  const isImage = isImageUrl(url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(url);
  return isImage ? (
    <img src={src} alt={caption} loading="lazy" className="h-full w-full object-cover" />
  ) : (
    <video
      src={`${src}#t=0.5`}
      muted
      playsInline
      preload="metadata"
      className="h-full w-full object-cover"
    />
  );
}

function SoundPage() {
  const { soundId } = Route.useParams();
  const auth = useAuth();
  const [sound, setSound] = useState<Sound | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setError(false);
    void getSound(soundId)
      .then((row) => setSound(row))
      .catch(() => setError(true));
    void getSoundVideos(soundId)
      .then((rows) => setVideos(rows))
      .catch(() => {
        setVideos([]);
        setError(true);
      });
  };

  useEffect(() => {
    setSound(null);
    setVideos(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundId]);

  useEffect(() => {
    void fetchMyLikes()
      .then(setLikedIds)
      .catch(() => {});
  }, [openIndex !== null]);

  useEffect(() => {
    if (openIndex === null) return;
    const el = viewerRef.current;
    const child = el?.children[openIndex] as HTMLElement | undefined;
    if (el && child) el.scrollTop = child.offsetTop;
  }, [openIndex]);

  const startWithSound = () => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    setRecordingOpen(true);
  };

  const uses = sound?.uses_count ?? videos?.length ?? 0;
  const title = sound?.title ?? "Original sound";
  const creator = sound?.creator_username ?? "";

  return (
    <div className="min-h-dvh bg-black text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            to="/"
            aria-label="Back to feed"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">Sound</p>
            <p className="truncate text-xs text-white/60">{formatUses(uses)}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6">
        <section className="flex items-start gap-4">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-white/20 bg-gradient-to-br from-zinc-600 via-zinc-900 to-black shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
            <span className="absolute inset-2 rounded-full border border-white/15" />
            <span className="absolute inset-[42%] rounded-full bg-white/80" />
            <Music className="relative h-9 w-9 text-white animate-spin-slow drop-shadow" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-bold leading-tight">{title}</h1>
            {creator && (
              <Link
                to="/u/$username"
                params={{ username: creator }}
                className="mt-1 inline-block text-sm font-semibold text-white/70 hover:text-white"
              >
                @{creator}
              </Link>
            )}
            <p className="mt-1 text-sm text-white/60">{formatUses(uses)}</p>
          </div>
        </section>

        <button
          type="button"
          onClick={startWithSound}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#fe2c55] py-3 text-[15px] font-bold text-white shadow-[0_10px_30px_-12px_#fe2c55] transition hover:brightness-110 active:scale-[0.99]"
        >
          <Music className="h-5 w-5" />
          Use this sound
        </button>

        <p className="mt-2 text-center text-[11px] leading-tight text-white/45">
          Original sounds only — recorded by Coolerup creators, never commercial music.
        </p>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/60">
            Videos using this sound
          </h2>
          {videos && videos.length > 0 && (
            <span className="text-xs text-white/50">{videos.length}</span>
          )}
        </div>

        {videos === null ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading videos…
          </div>
        ) : videos.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-14 text-center">
            <Music className="mx-auto h-8 w-8 text-white/40" />
            <p className="mt-3 text-sm font-semibold">
              {error ? "Couldn't load this sound" : "No videos yet"}
            </p>
            <p className="mt-1 text-xs text-white/50">
              {error
                ? "Check your connection and try again."
                : "Be the first to make a video with this sound."}
            </p>
            <button
              type="button"
              onClick={startWithSound}
              className="mt-4 rounded-full bg-[#fe2c55] px-5 py-2 text-sm font-bold"
            >
              Use this sound
            </button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-1 sm:gap-2">
            {videos.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setOpenIndex(i)}
                aria-label={`Play video by @${v.username}`}
                className="group relative aspect-[9/16] overflow-hidden rounded-md bg-zinc-800"
              >
                <Thumb url={v.video_url} caption={parseCaption(v.caption || "").text} />
                <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 text-[11px] font-bold text-white drop-shadow">
                  <Play className="h-3 w-3 fill-current" />
                  {formatCount(v.likes_count || 0)}
                </span>
                <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                  <Play className="h-3 w-3 fill-current" />
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      {openIndex !== null && videos && videos.length > 0 && (
        <div className="fixed inset-0 z-40 bg-black">
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label="Close viewer"
            className="absolute left-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <div ref={viewerRef} className="h-dvh snap-y snap-mandatory overflow-y-scroll">
            {videos.map((v) => (
              <div key={v.id} className="h-dvh snap-start snap-always">
                <VideoCard
                  video={v}
                  liked={likedIds.has(v.id)}
                  muted={muted}
                  onToggleMute={() => setMuted((m) => !m)}
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

      <RecordDialog
        open={recordingOpen}
        onOpenChange={setRecordingOpen}
        username={auth.handle}
        sound={sound}
        onUploadInstead={() => {
          setRecordingOpen(false);
          setUploadOpen(true);
        }}
        onPosted={load}
      />

      {uploadOpen && auth.handle && (
        <UploadDialog
          defaultUsername={auth.handle}
          sound={sound}
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            setUploadOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
