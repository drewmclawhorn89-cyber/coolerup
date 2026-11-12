import { formatProfileCount, type ProfileCounts } from "@/lib/profile";

type Props = {
  counts: ProfileCounts | null;
  username: string;
  onOpenFollowers?: () => void;
  onOpenFollowing?: () => void;
};

/**
 * Profile header numbers.
 *
 * Every value here is the *same* exact count the tabs use — they are passed in
 * as one `counts` object, never recomputed from fetched arrays:
 *
 *   videos        = Videos tab total
 *   likes         = Liked tab total (likes this profile GAVE)
 *   likesReceived = separate stat, likes their videos earned
 *   followers / following = exact follow counts
 *
 * Display is TikTok-style: compact ("1542" -> "1.5K") in the header, with the
 * full number in `title`. The tabs show the exact number, but both read from
 * the same source, so "1.5K" and "1542" can never contradict each other.
 */
export function ProfileStats({ counts, username, onOpenFollowers, onOpenFollowing }: Props) {
  const ready = counts !== null;
  const videos = counts?.videos ?? 0;
  const likes = counts?.likes ?? 0;
  const likesReceived = counts?.likesReceived ?? 0;
  const followers = counts?.followers ?? 0;
  const following = counts?.following ?? 0;

  return (
    <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm">
      <span title={`${videos} videos`}>
        <b className="tabular-nums">{ready ? formatProfileCount(videos) : "-"}</b> videos
      </span>
      <span title={`${likes} likes given`}>
        <b className="tabular-nums">{ready ? formatProfileCount(likes) : "-"}</b> likes
      </span>
      <span title={`${likesReceived} likes received`}>
        <b className="tabular-nums">{ready ? formatProfileCount(likesReceived) : "-"}</b> likes
        received
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
