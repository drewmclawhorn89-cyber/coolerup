import { formatProfileCount, type ProfileCounts } from "@/lib/profile";

type Props = {
  counts: ProfileCounts | null;
  username: string;
  onOpenFollowers?: () => void;
  onOpenFollowing?: () => void;
};

/**
 * Profile header numbers. Values are exact counts (never array lengths), shown
 * TikTok-style — "1542" becomes "1.5K" but the full number stays in `title` and
 * in the tab labels.
 */
export function ProfileStats({ counts, username, onOpenFollowers, onOpenFollowing }: Props) {
  const ready = counts !== null;
  const videos = counts?.videos ?? 0;
  const likes = counts?.likesReceived ?? 0;
  const followers = counts?.followers ?? 0;
  const following = counts?.following ?? 0;

  return (
    <div className="flex gap-8 text-sm">
      <span title={`${videos} videos`}>
        <b className="tabular-nums">{ready ? formatProfileCount(videos) : "-"}</b> videos
      </span>
      <span title={`${likes} likes`}>
        <b className="tabular-nums">{ready ? formatProfileCount(likes) : "-"}</b> likes
      </span>
      <button
        type="button"
        onClick={onOpenFollowers}
        className="rounded transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`View accounts following @${username}`}
        title={`${followers} followers`}
      >
        <b className="tabular-nums">{ready ? formatProfileCount(followers) : "-"}</b> followers
      </button>
      <button
        type="button"
        onClick={onOpenFollowing}
        className="rounded transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`View accounts @${username} is following`}
        title={`${following} following`}
      >
        <b className="tabular-nums">{ready ? formatProfileCount(following) : "-"}</b> following
      </button>
    </div>
  );
}
