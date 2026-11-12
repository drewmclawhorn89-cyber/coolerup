import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { refreshYouTubeDurations, saveYouTubeDurations } from "./youtube.functions";
import { probeYouTubeDurations } from "./youtubeDurationProbe";
import type { FullVideo } from "./fullVideos";

/** How many unknown cards we look up in one pass. */
const BATCH = 6;

/**
 * Backfill the length of YouTube picks so their grid cards show a duration
 * badge like every native upload does.
 *
 * Rows added before we learned to read YouTube's page sit at `duration = 0`.
 * Two sources, in order:
 *
 *  1. the server, which reads the length out of the watch page when YouTube
 *     feels like answering (fast and free when it works);
 *  2. the browser's own YouTube IFrame player, for whatever the server could
 *     not get — YouTube throttles datacenter IPs, not home connections.
 *
 * Either way the answer is written back to the row, so this happens once per
 * video rather than once per visit. Ids that fail are remembered for the rest
 * of the session, so a live stream or a private video can't become a request
 * loop; the next batch starts as soon as the previous one has been merged.
 */
export function useYouTubeDurations(
  videos: FullVideo[],
  onDurations: (durations: Record<string, number>) => void,
) {
  const refresh = useServerFn(refreshYouTubeDurations);
  const save = useServerFn(saveYouTubeDurations);
  const callback = useRef(onDurations);
  callback.current = onDurations;
  /** Ids currently being looked up — keeps StrictMode's double effect honest. */
  const inFlight = useRef<Set<string>>(new Set());
  /** Ids that gave us nothing; never asked again this session. */
  const gaveUp = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missing = videos
      .filter((video) => video.is_youtube && video.youtube_id && !(Number(video.duration) > 0))
      .map((video) => video.youtube_id as string)
      .filter((id) => !inFlight.current.has(id) && !gaveUp.current.has(id));

    const ids = [...new Set(missing)].slice(0, BATCH);
    if (ids.length === 0) return;
    for (const id of ids) inFlight.current.add(id);

    void (async () => {
      const found: Record<string, number> = {};
      const fromProbe: Record<string, number> = {};

      try {
        Object.assign(found, await refresh({ data: { ids } }));
      } catch {
        // Server couldn't reach YouTube; the browser still can.
      }

      const stillMissing = ids.filter((id) => !found[id]);
      if (stillMissing.length > 0) {
        try {
          Object.assign(fromProbe, await probeYouTubeDurations(stillMissing));
          Object.assign(found, fromProbe);
        } catch {
          // No badge is a fine outcome; never block the grid on this.
        }
      }

      for (const id of ids) {
        if (!found[id]) gaveUp.current.add(id);
        inFlight.current.delete(id);
      }

      if (Object.keys(found).length === 0) return;

      // Merge by youtube_id, so applying this after the grid has paged or
      // re-filtered is still correct.
      callback.current(found);

      if (Object.keys(fromProbe).length > 0) {
        void save({ data: { durations: fromProbe } }).catch(() => {});
      }
    })();
  }, [videos, refresh, save]);
}

/** Merge a `youtube_id -> seconds` map into a list of videos. */
export function withYouTubeDurations(
  videos: FullVideo[],
  durations: Record<string, number>,
): FullVideo[] {
  return videos.map((video) => {
    const seconds = video.youtube_id ? durations[video.youtube_id] : undefined;
    return seconds && seconds > 0 ? { ...video, duration: seconds } : video;
  });
}
