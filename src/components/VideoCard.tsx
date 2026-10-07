import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Share2, Play, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatCount, getDeviceId, resolveVideoUrl, type Video } from "@/lib/loop";
import { Comments } from "./Comments";

export function VideoCard({
  video,
  liked,
  muted,
  onToggleMute,
  onLikeChange,
}: {
  video: Video;
  liked: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onLikeChange: (liked: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [likes, setLikes] = useState(video.likes_count);
  const [comments, setComments] = useState(video.comments_count);
  const [shares, setShares] = useState(video.shares_count);
  const [showComments, setShowComments] = useState(false);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    resolveVideoUrl(video.video_url).then(setSrc);
  }, [video.video_url]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e && e.isIntersecting && e.intersectionRatio > 0.6) el.play().catch(() => {});
        else el.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [src]);

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  };

  const toggleLike = async () => {
    const next = !liked;
    onLikeChange(next);
    setLikes((n) => n + (next ? 1 : -1));
    if (next) {
      setBurst(true);
      setTimeout(() => setBurst(false), 500);
    }
    const device_id = getDeviceId();
    const { error } = next
      ? await supabase.from("likes").insert({ video_id: video.id, device_id })
      : await supabase.from("likes").delete().eq("video_id", video.id).eq("device_id", device_id);
    if (error) {
      onLikeChange(!next);
      setLikes((n) => n + (next ? -1 : 1));
      toast.error("Couldn't save your like");
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/?v=${video.id}`;
    try {
      if (navigator.share) await navigator.share({ title: `@${video.username} on Loop`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
      setShares((n) => n + 1);
      await supabase.rpc("increment_share", { _video_id: video.id });
    } catch {
      /* cancelled */
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
  };

  return (
    <section className="flex h-full snap-start snap-always items-center justify-center py-4">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-3">
          <div className="relative aspect-[9/16] h-[calc(100vh-11rem)] max-h-[760px] overflow-hidden rounded-2xl bg-card">
            {src && (
              <video
                ref={ref}
                src={src}
                loop
                muted={muted}
                playsInline
                preload="metadata"
                onClick={togglePlay}
                onDoubleClick={() => !liked && toggleLike()}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration) setProgress((v.currentTime / v.duration) * 100);
                }}
                className="h-full w-full cursor-pointer object-cover"
              />
            )}
            {!playing && src && (
              <button
                onClick={togglePlay}
                aria-label="Play"
                className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-overlay text-foreground backdrop-blur"
              >
                <Play className="ml-1 h-7 w-7 fill-current" />
              </button>
            )}
            {burst && (
              <Heart className="pointer-events-none absolute inset-0 m-auto h-24 w-24 animate-ping fill-primary text-primary" />
            )}
            <button
              onClick={onToggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className="absolute right-3 top-3 rounded-full bg-overlay p-2 text-foreground backdrop-blur"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <div onClick={seek} className="absolute inset-x-0 bottom-0 h-3 cursor-pointer">
              <div className="absolute inset-x-0 bottom-0 h-1 bg-foreground/20">
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
          <div className="max-w-[calc((100vh-11rem)*9/16)]">
            <p className="font-bold">@{video.username}</p>
            <p className="text-sm text-muted-foreground">{video.caption}</p>
          </div>
        </div>
        <div className="mb-16 flex flex-col items-center gap-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary font-display text-lg uppercase text-primary-foreground">
            {video.username[0]}
          </div>
          <Action label={formatCount(likes)} onClick={toggleLike} active={liked}>
            <Heart className={`h-6 w-6 ${liked ? "fill-primary text-primary" : ""}`} />
          </Action>
          <Action label={formatCount(comments)} onClick={() => setShowComments(true)}>
            <MessageCircle className="h-6 w-6" />
          </Action>
          <Action label={formatCount(shares)} onClick={share}>
            <Share2 className="h-6 w-6" />
          </Action>
        </div>
      </div>
      {showComments && (
        <Comments
          videoId={video.id}
          onClose={() => setShowComments(false)}
          onAdded={() => setComments((n) => n + 1)}
        />
      )}
    </section>
  );
}

function Action({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 text-xs font-semibold">
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full bg-secondary transition hover:bg-accent ${active ? "scale-110" : ""}`}
      >
        {children}
      </span>
      {label}
    </button>
  );
}
