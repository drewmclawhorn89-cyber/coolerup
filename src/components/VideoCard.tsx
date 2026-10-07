import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Share2, Play, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatCount, getDeviceId, resolveVideoUrl, type Video } from "@/lib/loop";
import { Comments } from "./Comments";
import { Button } from "@/components/ui/button";

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
    <section className="flex h-full snap-start snap-always items-center justify-center md:py-4">
      <div className="relative flex h-full w-full items-end md:h-auto md:w-auto md:gap-4">
        <div className="flex h-full min-w-0 flex-1 flex-col md:h-auto md:flex-none md:gap-3">
          <div className="relative h-full w-full overflow-hidden bg-card md:aspect-[9/16] md:h-[calc(100dvh-11rem)] md:max-h-[760px] md:w-auto md:rounded-2xl">
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
              <Button variant="ghost" size="icon"
                onClick={togglePlay}
                aria-label="Play"
                className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-overlay text-foreground backdrop-blur"
              >
                <Play className="ml-1 h-7 w-7 fill-current" />
              </Button>
            )}
            {burst && (
              <Heart className="pointer-events-none absolute inset-0 m-auto h-24 w-24 animate-ping fill-primary text-primary" />
            )}
            <Button variant="ghost" size="icon"
              onClick={onToggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className="absolute right-3 top-3 rounded-full bg-overlay p-2 text-foreground backdrop-blur"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            <div className="video-caption absolute inset-x-0 bottom-2 pb-5 pl-4 pr-20 pt-16 md:hidden">
              <p className="break-words text-sm font-bold">@{video.username}</p>
              <p className="mt-1 line-clamp-3 break-words text-sm">{video.caption}</p>
            </div>
            <div onClick={seek} className="absolute inset-x-0 bottom-0 h-3 cursor-pointer">
              <div className="absolute inset-x-0 bottom-0 h-1 bg-foreground/20">
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
          <div className="hidden max-w-[calc((100dvh-11rem)*9/16)] md:block">
            <p className="font-bold">@{video.username}</p>
            <p className="text-sm text-muted-foreground">{video.caption}</p>
          </div>
        </div>
        <div className="absolute bottom-16 right-2 flex flex-col items-center gap-4 md:static md:mb-16 md:gap-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-display text-lg uppercase text-primary-foreground md:h-12 md:w-12">
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
    <Button variant="ghost" onClick={onClick} aria-label={typeof children === "object" && children ? undefined : label} className="h-auto flex-col gap-1 p-0 text-xs font-semibold hover:bg-transparent [&_svg]:size-6">
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full bg-overlay backdrop-blur-sm transition hover:bg-accent md:h-12 md:w-12 md:bg-secondary ${active ? "scale-110" : ""}`}
      >
        {children}
      </span>
      {label}
    </Button>
  );
}
