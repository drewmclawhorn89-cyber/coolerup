/**
 * Coolerup · 18+ Mature videos
 *
 * A creator can mark any single video (short form or long form) as 18+ when
 * they post it. The flag is stored as `is_mature` on the row and is OFF by
 * default, so nothing changes for existing uploads.
 *
 * Watching rules, kept deliberately simple and testable:
 *   - an 18+ video is never auto-played in the feed; it shows a blurred
 *     thumbnail, an "18+ Mature" label and a lock icon instead
 *   - the viewer unlocks it with the Date of Birth already on their Coolerup
 *     account. No camera, no face scan, no selfie check.
 *   - if that DOB makes them under 18, playback is blocked with
 *     "You must be 18+ to watch this video"
 *   - Settings > Privacy has a "Show 18+ Videos" switch. When it is OFF, all
 *     18+ videos disappear from the feed entirely.
 */
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ageFromBirthday } from "@/lib/auth";
import { readBool, writePref } from "@/lib/prefs";

/** Someone must be this old to watch a video the creator marked 18+. */
export const MATURE_MIN_AGE = 18;

/** Exact label shown on the blurred card and the watch page. */
export const MATURE_LABEL = "18+ Mature";

/** Exact copy shown when the account's DOB says the viewer is under 18. */
export const MATURE_BLOCKED_MESSAGE = "You must be 18+ to watch this video";

/** Settings > Privacy key. Defaults to ON, matching every other feed setting. */
export const SHOW_MATURE_PREF = "show-mature";

/** True when a video row was marked 18+ by its creator. */
export function isMatureVideo(video: { is_mature?: boolean | null } | null | undefined): boolean {
  return Boolean(video?.is_mature);
}

/**
 * True when a birthday (YYYY-MM-DD) makes someone 18 or older today.
 * A missing or malformed birthday is treated as "not verified", never as an
 * adult, so an incomplete profile cannot unlock mature content.
 */
export function isAdultBirthday(
  birthday: string | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!birthday) return false;
  return ageFromBirthday(birthday, today) >= MATURE_MIN_AGE;
}

/**
 * Whether the viewer may watch a mature video. Returns the exact reason so the
 * UI can show the right message instead of a generic lock.
 */
export function matureWatchState(
  birthday: string | null | undefined,
  today: Date = new Date(),
): { allowed: boolean; reason: "ok" | "no-dob" | "underage" } {
  if (!birthday) return { allowed: false, reason: "no-dob" };
  if (!isAdultBirthday(birthday, today)) return { allowed: false, reason: "underage" };
  return { allowed: true, reason: "ok" };
}

/** Settings > Privacy "Show 18+ Videos". ON unless the viewer turned it off. */
export function showMatureVideos(): boolean {
  return readBool(SHOW_MATURE_PREF, true);
}

export function setShowMatureVideos(next: boolean): void {
  writePref(SHOW_MATURE_PREF, String(next));
}

/**
 * Viewer-side gate for a single video. Combines the row flag with the account
 * birthday so a card and the watch page can never disagree about whether the
 * video is playable.
 */
export function useMatureGate(video: { is_mature?: boolean | null } | null | undefined) {
  const auth = useAuth();
  const birthday = auth.onboarding.birthday ?? null;
  return useMemo(() => {
    const mature = isMatureVideo(video);
    const state = matureWatchState(birthday);
    return {
      mature,
      birthday,
      allowed: !mature || state.allowed,
      reason: state.reason,
      blockedMessage: state.reason === "underage" ? MATURE_BLOCKED_MESSAGE : null,
    };
  }, [video, birthday]);
}
