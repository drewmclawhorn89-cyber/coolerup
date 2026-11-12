/**
 * GTA 6 challenge \u2014 "post 10 GTA videos, get 1 month of Pro free".
 *
 * Runs only inside the GTA 6 window (Nov 8 \u2013 Nov 15 2026) and never comes back.
 *
 * The database owns every decision: `claim_gta6_challenge()` counts the posts
 * itself, re-checks the window, and refuses a second claim. This module is just
 * the typed client around those RPCs plus the local grant, which it writes
 * through `applyCodeSubscription` so the reward expires on its own exactly like
 * a redeemed subscription code.
 *
 * Keep the constants in sync with supabase/migrations/20261127000000_gta6_challenge.sql.
 */
import { supabase } from "@/integrations/supabase/client";
import { GTA6_HASHTAG, GTA6_VIDEOS_TO_WIN, isGTA6Ended, isGTA6Mode } from "@/lib/gta6";
import { applyCodeSubscription, getSubscription, type Subscription } from "@/lib/subscriptions";

/** How many GTA videos unlock the reward. Mirrors the SQL literal. */
export const GTA6_CHALLENGE_REQUIRED = GTA6_VIDEOS_TO_WIN;

/** The plan the reward grants. `pro` is the app's Pro tier. */
export const GTA6_CHALLENGE_PLAN_ID = "pro";

/** How long the reward lasts. */
export const GTA6_CHALLENGE_MONTHS = 1;

/** Recorded as the grant's code so the subscription screen can label it. */
export const GTA6_CHALLENGE_CODE = "GTA6-CHALLENGE";

/** Human label for the reward, used in banners and toasts. */
export const GTA6_CHALLENGE_REWARD_LABEL = "1 month of Pro free";

export type GTA6ChallengeProgress = {
  /** GTA videos the signed-in user has posted inside the window. */
  posted: number;
  /** How many are needed. */
  required: number;
  /** True once `posted` reaches `required`. */
  eligible: boolean;
  /** True when the reward has already been claimed. */
  claimed: boolean;
  /** End of the granted plan, when claimed. */
  claimedEndsAt: string | null;
  /** End of the event window. */
  endsAt: string | null;
};

export type GTA6ClaimError =
  "not_signed_in" | "not_enough_videos" | "already_claimed" | "ended" | "unknown";

export type GTA6ClaimResult =
  | { ok: true; planId: string; months: number; endsAt: string }
  | { ok: false; error: GTA6ClaimError; message: string; posted?: number; required?: number };

const CLAIM_ERRORS: Record<GTA6ClaimError, string> = {
  not_signed_in: "Sign in to claim the GTA 6 reward",
  not_enough_videos: "Post more GTA 6 videos to unlock it",
  already_claimed: "You already claimed the GTA 6 reward",
  ended: "The GTA 6 event has ended",
  unknown: "Couldn't claim the reward. Try again.",
};

export function gta6ClaimErrorMessage(error: GTA6ClaimError): string {
  return CLAIM_ERRORS[error] ?? CLAIM_ERRORS.unknown;
}

/**
 * Same `this`-binding trap as `src/lib/codes.ts`: `supabase.rpc` reads
 * `this.rest`, so a detached reference throws.
 */
async function rpc(name: string, args?: Record<string, unknown>) {
  const call = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  try {
    return await call(name, args);
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "Network error" },
    };
  }
}

/** Progress for the signed-in user. Returns null when signed out or offline. */
export async function fetchGTA6ChallengeProgress(): Promise<GTA6ChallengeProgress | null> {
  const { data, error } = await rpc("gta6_challenge_progress");
  if (error || !data || typeof data !== "object") return null;

  const row = data as {
    ok?: boolean;
    posted?: number;
    required?: number;
    eligible?: boolean;
    claimed?: boolean;
    claimed_ends_at?: string | null;
    ends_at?: string | null;
  };
  if (!row.ok) return null;

  const required = Number(row.required ?? GTA6_CHALLENGE_REQUIRED);
  const posted = Number(row.posted ?? 0);

  return {
    posted,
    required,
    eligible: row.eligible ?? posted >= required,
    claimed: row.claimed ?? false,
    claimedEndsAt: row.claimed_ends_at ?? null,
    endsAt: row.ends_at ?? null,
  };
}

/**
 * Claim the reward and write the grant locally.
 *
 * The server is the authority: it recounts the posts and re-checks the window.
 * `applyCodeSubscription` stacks the month on top of a live code grant, so a
 * user who already redeemed a gift card keeps both.
 */
export async function claimGTA6Challenge(handle?: string | null): Promise<GTA6ClaimResult> {
  if (!handle) {
    return {
      ok: false,
      error: "not_signed_in",
      message: CLAIM_ERRORS.not_signed_in,
    };
  }

  // Fail fast on the client so we never even call the RPC after the event.
  if (isGTA6Ended()) {
    return { ok: false, error: "ended", message: CLAIM_ERRORS.ended };
  }

  const { data, error } = await rpc("claim_gta6_challenge");
  if (error) {
    return {
      ok: false,
      error: "unknown",
      message: error.message || CLAIM_ERRORS.unknown,
    };
  }

  const row = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    plan?: string;
    months?: number;
    ends_at?: string;
    posted?: number;
    required?: number;
  };

  if (!row.ok) {
    const key = (row.error ?? "unknown") as GTA6ClaimError;
    const failure: GTA6ClaimResult = {
      ok: false,
      error: key,
      message: gta6ClaimErrorMessage(key),
    };
    // exactOptionalPropertyTypes: only attach the counts when we have them.
    if (typeof row.posted === "number") failure.posted = row.posted;
    if (typeof row.required === "number") failure.required = row.required;
    return failure;
  }

  const months = Number(row.months ?? GTA6_CHALLENGE_MONTHS);
  const endsAt = row.ends_at ?? new Date().toISOString();

  applyCodeSubscription(handle, {
    planId: row.plan ?? GTA6_CHALLENGE_PLAN_ID,
    code: GTA6_CHALLENGE_CODE,
    months,
    endsAt,
  });

  return {
    ok: true,
    planId: row.plan ?? GTA6_CHALLENGE_PLAN_ID,
    months,
    endsAt,
  };
}

/**
 * Re-apply a reward claimed on another device.
 *
 * The subscription record lives in localStorage, so a fresh browser looks like
 * the reward was never claimed. This pulls the server's grant and writes it
 * locally when the current record is missing or already expired.
 */
export async function restoreGTA6ChallengeReward(
  handle?: string | null,
): Promise<Subscription | null> {
  if (!handle) return null;

  const { data, error } = await rpc("my_gta6_challenge_reward");
  if (error || !data || typeof data !== "object") return null;

  const row = data as {
    ok?: boolean;
    plan?: string;
    months?: number;
    ends_at?: string;
  };
  if (!row.ok || !row.ends_at) return null;

  const endsAt = row.ends_at;
  if (new Date(endsAt).getTime() <= Date.now()) return null;

  const existing = getSubscription(handle);
  // Don't clobber a live paid plan or a longer code grant.
  if (existing?.status === "active") {
    const existingEnd = existing.currentPeriodEnd ? new Date(existing.currentPeriodEnd) : null;
    const stillLive = existingEnd ? existingEnd.getTime() > Date.now() : true;
    if (existing.source !== "code" && stillLive) return existing;
    if (
      existing.source === "code" &&
      existingEnd &&
      existingEnd.getTime() >= new Date(endsAt).getTime()
    ) {
      return existing;
    }
  }

  applyCodeSubscription(handle, {
    planId: row.plan ?? GTA6_CHALLENGE_PLAN_ID,
    code: GTA6_CHALLENGE_CODE,
    months: Number(row.months ?? GTA6_CHALLENGE_MONTHS),
    endsAt,
  });

  return getSubscription(handle);
}

/* -------------------------------------------------------------------------- */
/*  Pure helpers (unit tested)                                                */
/* -------------------------------------------------------------------------- */

/** 0-100, clamped, for the progress bar. */
export function gta6ProgressPercent(posted: number, required = GTA6_CHALLENGE_REQUIRED): number {
  if (!Number.isFinite(posted) || required <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((posted / required) * 100)));
}

/** "7 / 10 GTA videos" */
export function gta6ProgressLabel(posted: number, required = GTA6_CHALLENGE_REQUIRED): string {
  const done = Math.max(0, Math.min(posted, required));
  return `${done} / ${required} GTA videos`;
}

/** How many more posts are needed. */
export function gta6Remaining(posted: number, required = GTA6_CHALLENGE_REQUIRED): number {
  return Math.max(0, required - Math.max(0, posted));
}

/**
 * Whether the challenge card should be on screen at all.
 *
 * Hidden once the event is over \u2014 the reward, like the rest of the update,
 * disappears on Nov 16 2026. An already-granted Pro plan keeps running until
 * its own end date because it lives in the subscription record.
 */
export function gta6ChallengeVisible(now = new Date()): boolean {
  return isGTA6Mode(now);
}

/** Copy for the caption hint, so the hashtag is always spelled the same way. */
export const GTA6_CHALLENGE_HASHTAG_HINT = `Add ${GTA6_HASHTAG} to your caption`;

/**
 * Append the challenge hashtag when it is missing.
 *
 * Used by the upload dialogs so picking the GTA 6 filter counts toward the
 * challenge without the user having to remember the tag. Idempotent and
 * case-insensitive, and it never pushes the caption past the 500-char limit the
 * upload path enforces.
 */
export function withGTA6Hashtag(caption: string): string {
  const trimmed = caption.trim();
  if (trimmed.toLowerCase().includes(GTA6_HASHTAG.toLowerCase())) return trimmed.slice(0, 500);

  // Reserve room for the hashtag before trimming the body, otherwise a long
  // caption would have the tag cut off and the post would not count.
  const suffix = ` ${GTA6_HASHTAG}`;
  const room = Math.max(0, 500 - suffix.length);
  const body = trimmed.slice(0, room).trimEnd();
  return body ? `${body}${suffix}` : GTA6_HASHTAG;
}
