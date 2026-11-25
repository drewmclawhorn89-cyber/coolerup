import { useState } from "react";
import { Play } from "lucide-react";
import { isImageUrl, type Video } from "@/lib/loop";
import { useCompressedThumbnail } from "@/lib/thumbnailCache";
import type { InboxActor, NotificationRow } from "@/lib/inboxNotifications";

function VideoThumbnail({ video }: { video: Video }) {
  const isTikTok = Boolean(video.is_tiktok && video.tiktok_id);
  const [failed, setFailed] = useState(false);

  const isImage =
    isImageUrl(video.video_url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(video.video_url);

  const src = useCompressedThumbnail(video.video_url, {
    isVideo: !isImage,
    maxDim: 160,
    enabled: Boolean(video.video_url && !isTikTok),
  });

  return (
    <div className="relative flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/15 bg-black/50">
      {src && !failed && !isTikTok ? (
        isImage ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <video
            src={`${src}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        )
      ) : (
        <Play className="h-4 w-4 text-white/75" aria-hidden />
      )}
    </div>
  );
}

function typeBadge(type: string | null): string {
  switch (type) {
    case "like":
      return "❤️";
    case "follow":
      return "👤";
    case "gift":
      return "🎁";
    case "repost":
      return "🔁";
    default:
      return "💬";
  }
}

export function InboxNotificationCard({
  notification,
  actor,
  video,
  onSelect,
}: {
  notification: NotificationRow;
  actor?: InboxActor | undefined;
  video?: Video | undefined;
  onSelect: (notification: NotificationRow) => void;
}) {
  const isFollow = notification.type === "follow";
  const showVideoThumb = Boolean(
    notification.video_id &&
    (notification.type === "like" ||
      notification.type === "comment" ||
      notification.type === "repost" ||
      notification.type === "gift"),
  );
  const initial = (actor?.handle ?? "").replace(/^@/, "").trim().charAt(0).toUpperCase();
  const avatarSrc = useCompressedThumbnail(actor?.avatar_url, {
    maxDim: 120,
    enabled: Boolean(actor?.avatar_url),
  });

  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 text-left text-card-foreground transition hover:brightness-110 active:scale-[0.99] ${
        notification.read ? "opacity-75" : ""
      }`}
    >
      <div className="relative h-11 w-11 shrink-0">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={actor?.handle ? `@${actor.handle}` : "Profile picture"}
            loading="lazy"
            decoding="async"
            className="h-11 w-11 rounded-full object-cover"
          />
        ) : isFollow && initial ? (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary font-display text-sm uppercase text-primary-foreground">
            {initial}
          </div>
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/20 text-lg">
            {typeBadge(notification.type)}
          </div>
        )}
        {avatarSrc && !isFollow && (
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-[10px] ring-1 ring-white/20"
          >
            {typeBadge(notification.type)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{notification.text}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {notification.created_at ? new Date(notification.created_at).toLocaleString() : ""}
        </p>
      </div>

      {!notification.read && (
        <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--account-accent)]" />
      )}

      {showVideoThumb &&
        (video ? (
          <VideoThumbnail video={video} />
        ) : (
          <div className="flex h-14 w-11 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/50">
            <Play className="h-4 w-4 text-white/50" aria-hidden />
          </div>
        ))}
    </button>
  );
}
