import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, MessageCircle, Share2, Play, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatCount, isImageUrl, parseCaption, resolveVideoUrl, songStreamUrl, type Video } from "@/lib/loop";
import { getSaved } from "@/lib/offline";
import { useAuth } from "@/hooks/useAuth";
import { haptic, readBool } from "@/lib/prefs";
import { Comments } from "./Comments";
import { ShareMenu } from "./ShareMenu";
import { Button } from "@/components/ui/button";
import { Repeat2 } from "lucide-react";
import { Bookmark } from "lucide-react";

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
  const [showShare, setShowShare] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [burst, setBurst] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const auth = useAuth();
  const myUsername = auth.handle;

  useEffect(() => {
    if (!auth.user) { setIsSaved(false); return; }
    supabase.from("saved_videos").select("video_id").eq("user_id", auth.user.id).eq("video_id", video.id).maybeSingle()
      .then(({ data }) => setIsSaved(!!data));
  }, [auth.user?.id, video.id]);

  const toggleSave = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!auth.user) { toast.error("Sign in to save videos"); return; }
    const next = !isSaved;
    setIsSaved(next);
    const { error } = next
      ? await supabase.from("saved_videos").insert({ user_id: auth.user.id, video_id: video.id })
      : await supabase.from("saved_videos").delete().eq("user_id", auth.user.id).eq("video_id", video.id);
    // 23505 = already saved, which is fine
    if (error && error.code !== "23505") {
      console.error(error);
      setIsSaved(!next);
      toast.error(`Couldn't save: ${error.message}`);
      return;
    }
    toast.success(next ? "Saved to your profile" : "Removed from saved");
  };
  const isImage = isImageUrl(video.video_url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(video.video_url);
  const { text: captionText, song } = parseCaption(video.caption);
  const songRef = useRef<HTMLAudioElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!auth.user || !myUsername || video.username === myUsername) return;
    supabase
      .from("follows")
      .select("id")
      .eq("follower_id", auth.user.id)
      .eq("following_username", video.username)
      .maybeSingle()
      .then(({ data }) => setIsFollowing(!!data));
  }, [video.username, auth.user?.id, myUsername]);

  const toggleFollow = async () => {
    if (!auth.user || !myUsername) return auth.signIn();
    const next = !isFollowing;
    setIsFollowing(next);
    const { error } = next
      ? await supabase.from("follows").insert({ follower_id: auth.user.id, follower_username: myUsername, following_username: video.username })
      : await supabase.from("follows").delete().eq("follower_id", auth.user.id).eq("following_username", video.username);
    if (error) {
      setIsFollowing(!next);
      toast.error("Couldn't update follow");
    }
  };
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setNear(!!e && e.isIntersecting),
      { rootMargin: "50% 0px 50% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!near) { setSrc(""); setPlaying(false); return; }
    let blobUrl = "";
    let alive = true;
    getSaved(video.id)
      .catch(() => null)
      .then(async (saved) => {
        if (!alive) return;
        if (saved) {
          blobUrl = URL.createObjectURL(saved.blob);
          setSrc(blobUrl);
        } else {
          const u = await resolveVideoUrl(video.video_url);
          if (alive) setSrc(u);
        }
      });
    return () => {
      alive = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [video.id, video.video_url, near]);

  useEffect(() => {
    const el = ref.current;
    if (!el || isImage) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e && e.isIntersecting && e.intersectionRatio > 0.6) { if (readBool("autoplay", true)) el.play().catch(() => {}); }
        else el.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [src]);

  useEffect(() => {
    const el = cardRef.current;
    const a = songRef.current;
    if (!el || !a || !song) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e && e.isIntersecting && e.intersectionRatio > 0.6) { a.currentTime = 0; a.play().catch(() => {}); }
        else a.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    obs.observe(el);
    return () => { obs.disconnect(); a.pause(); };
  }, [song?.id]);

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  };

 const toggleLike = async () => {
  const next = !liked;
  haptic();
  onLikeChange(next);
  setLikes((n) => n + (next ? 1 : -1));
  if (next) {
    setBurst(true);
    setTimeout(() => setBurst(false), 650);
  }
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    toast.error("Please log in to like");
    onLikeChange(!next);
    setLikes((n) => n + (next ? -1 : 1));
    return;
  }
  const { error } = next
    ? await supabase.from("likes").insert({ video_id: video.id, user_id: authUser.id })
    : await supabase.from("likes").delete().eq("video_id", video.id).eq("user_id", authUser.id);
  if (error) {
    onLikeChange(!next);
    setLikes((n) => n + (next ? -1 : 1));
    toast.error("Couldn't save your like");
  } else if (next) {
    // save notification to account
    const { data: owner } = await supabase.from("profiles").select("id").eq("handle", video.username).maybeSingle();
    if (owner && owner.id !== authUser.id) {
      await supabase.from("notifications").insert({
        target_user_id: owner.id,
        actor_user_id: authUser.id,
        type: 'like',
        video_id: video.id,
        text: 'liked your fit'
      });
    }
  }
};
  const onShared = async () => {
    setShares((n) => n + 1);
    if (navigator.onLine) await supabase.rpc("increment_share", { _video_id: video.id });
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
  };

  if (deleted) return null;

  return (
    <section className="relative h-full w-full snap-start snap-always bg-black md:flex md:items-center md:justify-center md:bg-transparent md:py-4">
      <div className="relative flex h-full w-full items-end md:h-auto md:w-auto md:gap-4">
        <div className="flex h-full min-w-0 flex-1 flex-col md:h-auto md:flex-none md:gap-3">
          <div ref={cardRef} className="relative h-full w-full overflow-hidden bg-black md:bg-card md:aspect-[9/16] md:h-[calc(100dvh-11rem)] md:max-h-[760px] md:w-auto md:rounded-2xl">
            {src && isImage && (
              <img
                src={src}
                loading="lazy"
                decoding="async"
                alt={captionText || `Photo by @${video.username}`}
                onDoubleClick={() => !liked && toggleLike()}
                className="h-full w-full cursor-pointer object-cover"
              />
            )}
            {song && isImage && <audio ref={songRef} src={songStreamUrl(song.id)} loop muted={muted} preload="none" />}
            {song && isImage && (
              <div className="absolute left-3 top-3 flex max-w-[70%] items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                <span aria-hidden>♫</span><span className="truncate">{song.title} · {song.artist}</span>
              </div>
            )}
            {src && !isImage && (
              <video
                ref={ref}
                src={src}
                loop
                muted={false}
                playsInline
                preload={readBool("data-saver") ? "none" : "metadata"}
                disableRemotePlayback
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
            
            {burst && (
              <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <Heart className="heart-pop h-28 w-28 fill-primary text-primary drop-shadow-[0_0_24px_rgba(255,45,85,0.8)]" />
              </div>
            )}
            <div className={`video-caption absolute inset-x-0 bottom-0 z-20 pb-20 pl-2 pr-20 pt-16 ${readBool("captions") ? "" : "md:hidden"}`}>
              <Link to="/u/$username" params={{ username: video.username }} className="break-words text-sm font-bold">@{video.username}</Link>
              <p className="mt-1 line-clamp-3 break-words text-sm">{captionText}</p>
            </div>
            {!isImage && (
            <div onClick={seek} className="absolute inset-x-0 bottom-0 h-3 cursor-pointer">
              <div className="absolute inset-x-0 bottom-0 h-1 bg-foreground/20">
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </div>
            )}
          </div>
          <div className="hidden max-w-[calc((100dvh-11rem)*9/16)] md:block">
            <Link to="/u/$username" params={{ username: video.username }} className="font-bold hover:text-primary">@{video.username}</Link>
            <p className="text-sm text-muted-foreground">{captionText}</p>
          </div>
        </div>
        <div className="absolute bottom-20 right-2 z-20 flex flex-col items-center gap-4 md:static md:mb-16 md:gap-5">
          <Link
            to="/u/$username"
            params={{ username: video.username }}
            aria-label={`View @${video.username}'s profile`}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-display text-lg uppercase text-primary-foreground md:h-12 md:w-12"
          >
            {video.username[0]}
          </Link>
          {video.username !== myUsername && (
            <button
              onClick={toggleFollow}
              className={`-mt-3 rounded-full px-3 py-1 text-xs font-bold transition ${isFollowing ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground"}`}
            >
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}

          <Action label={formatCount(likes)} onClick={toggleLike} active={liked}>
            <Heart className={`h-8 w-8 ${liked ? "fill-primary text-white" : ""} ${liked && burst ? "heart-pop-btn" : ""}`} />
          </Action>
          <Action label={formatCount(comments)} onClick={() => setShowComments(true)}>
            <MessageCircle className="h-8 w-8" />
          </Action>
          <Action label={formatCount(shares)} onClick={() => setShowShare(true)}>
            <Share2 className="h-8 w-8" />
          </Action>
            <button type="button" onClick={(e) => void toggleSave(e)} className="flex flex-col items-center">
  <Bookmark className={`h-8 w-8 text-white ${isSaved ? "fill-yellow-400 text-yellow-400" : ""}`} />
  <span className="text-white text-[11px] mt-1">Save</span>
</button> 
        </div>
      </div>
      {showComments && (
        <Comments
          videoId={video.id}
          onClose={() => setShowComments(false)}
          onAdded={() => setComments((n) => n + 1)}
        />
      )}
      {showShare && <ShareMenu video={video} onClose={() => setShowShare(false)} onShared={onShared} onDeleted={() => setDeleted(true)} />}
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
