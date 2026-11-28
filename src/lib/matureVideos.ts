/**
 * Coolerup · 18+ Mature videos
 *
 * A creator can mark any single video (short form or long form) as 18+ when
 * they post it. The flag is stored as `is_mature` on the row and is OFF by
 * default, so nothing changes for existing uploads.
 *
 * Watching rules, in order:
 *   1. an 18+ video is never auto-played anywhere — feed card, grid or watch
 *      page. It shows a blurred frame, an "18+ Mature" label and a lock.
 *   2. the account's Date of Birth must say 18 or older. Under 18 is blocked
 *      outright with "You must be 18+ to watch this video".
 *   3. the account must ALSO have a moderator-approved government ID
 *      (`age_verifications.status = 'approved'`). A typed-in birthday is
 *      self-reported, so it can never be the only proof.
 *   4. Settings > Privacy has a "Show 18+ Videos" switch. When it is OFF, all
 *      18+ videos disappear from the feed entirely.
 *
 * No camera, no face scan, no selfie matching inside the app: the selfie is
 * only ever looked at by a human moderator alongside the ID.
 */
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ageFromBirthday } from "@/lib/auth";
import { readBool, writePref } from "@/lib/prefs";
import {
  AGE_DOB_MISSING_MESSAGE,
  AGE_VERIFY_PENDING_MESSAGE,
  AGE_VERIFY_REJECTED_MESSAGE,
  AGE_VERIFY_REQUIRED_MESSAGE,
  useAgeVerification,
  type AgeVerificationStatus,
} from "@/lib/ageVerification";

/** Someone must be this old to watch a video the creator marked 18+. */
export const MATURE_MIN_AGE = 18;

/** Exact label shown on the blurred card and the watch page. */
export const MATURE_LABEL = "18+ Mature";

/** Exact copy shown when the account's DOB says the viewer is under 18. */
export const MATURE_BLOCKED_MESSAGE = "You must be 18+ to watch this video";

/** Settings > Privacy key. Defaults to ON, matching every other feed setting. */
export const SHOW_MATURE_PREF = "show-mature";

/** Why a mature video is locked. `ok` means it may play. */
export type MatureBlockReason =
  | "ok"
  | "no-dob"
  | "underage"
  | "unverified"
  | "pending"
  | "rejected";

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
 * Whether the viewer may watch a mature video.
 *
 * Both checks must pass: the birthday must be 18+ *and* a moderator must have
 * approved an ID. Returns the exact reason so the UI can show the right
 * message — and the right next step — instead of a generic lock.
 */
export function matureWatchState(
  birthday: string | null | undefined,
  today: Date = new Date(),
  verification: AgeVerificationStatus = "none",
): { allowed: boolean; reason: MatureBlockReason } {
  if (!birthday) return { allowed: false, reason: "no-dob" };
  if (!isAdultBirthday(birthday, today)) return { allowed: false, reason: "underage" };
  if (verification === "approved") return { allowed: true, reason: "ok" };
  if (verification === "pending") return { allowed: false, reason: "pending" };
  if (verification === "rejected") return { allowed: false, reason: "rejected" };
  return { allowed: false, reason: "unverified" };
}

/** The one-line explanation that matches a block reason. */
export function matureBlockMessage(reason: MatureBlockReason): string | null {
  switch (reason) {
    case "ok":
      return null;
    case "no-dob":
      return AGE_DOB_MISSING_MESSAGE;
    case "underage":
      return MATURE_BLOCKED_MESSAGE;
    case "pending":
      return AGE_VERIFY_PENDING_MESSAGE;
    case "rejected":
      return AGE_VERIFY_REJECTED_MESSAGE;
    case "unverified":
      return AGE_VERIFY_REQUIRED_MESSAGE;
  }
}

/** Settings > Privacy "Show 18+ Videos". ON unless the viewer turned it off. */
export function showMatureVideos(): boolean {
  return readBool(SHOW_MATURE_PREF, true);
}

export function setShowMatureVideos(next: boolean): void {
  writePref(SHOW_MATURE_PREF, String(next));
}

/**
 * Viewer-side gate for a single video. Combines the row flag, the account
 * birthday and the ID check so a card and the watch page can never disagree
 * about whether the video is playable.
 *
 * While the verification status is still loading the gate reports `allowed:
 * false`, so a mature video never plays for a moment before locking.
 */
export function useMatureGate(video: { is_mature?: boolean | null } | null | undefined) {
  const auth = useAuth();
  const birthday = auth.onboarding.birthday ?? null;
  const { status, loading } = useAgeVerification(Boolean(auth.user));
  return useMemo(() => {
    const mature = isMatureVideo(video);
    const state = matureWatchState(birthday, new Date(), status);
    // Fail closed: an unresolved status is not an approval.
    const allowed = !mature || (!loading && state.allowed);
    return {
      mature,
      birthday,
      allowed,
      loading,
      verificationStatus: status,
      reason: state.reason,
      blockedMessage: matureBlockMessage(state.reason),
      /** True when the viewer should be offered the "Verify my ID" button. */
      needsVerification:
        mature && (state.reason === "unverified" || state.reason === "rejected"),
      /** True when the viewer is too young and no upload can help. */
      underage: state.reason === "underage",
      /** True when the account has no birthday on file yet. */
      needsBirthday: state.reason === "no-dob",
    };
  }, [video, birthday, status, loading]);
}
