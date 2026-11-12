import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Onboarding rules and data access.
 *
 * Design notes:
 * - `profiles.username` / `profiles.birthday` are nullable so accounts that
 *   signed up before onboarding existed keep working and keep every video and
 *   like they already have.
 * - Nothing here ever deletes or rewrites videos/likes. The only write is an
 *   UPDATE on the caller's own `profiles` row.
 * - Old accounts already have `profiles.handle`. We pre-fill the username field
 *   from it but never overwrite an existing handle that has videos attached.
 */

export const MIN_AGE = 13;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/** Usernames nobody may claim, even if the DB table is unavailable. */
export const RESERVED_USERNAMES = new Set(["drewmclawhorn3", "coolerup", "admin", "support"]);

/**
 * Spam / bot-looking usernames we refuse:
 *  - `bot095` style: "bot" followed by digits
 *  - `lz.zb_5o.0` style: 3+ very short dot/underscore segments with digits
 */
const BOT_RE = /bot\d{2,}/i;
const RANDOM_SEGMENTS_RE = /^[a-z]{1,3}([._][a-z0-9]{1,3}){2,}$/;

export type OnboardingState = {
  /** True when username + birthday are present and the flag is set. */
  complete: boolean;
  /** True when the account still needs to finish onboarding. */
  needsOnboarding: boolean;
  username: string | null;
  birthday: string | null;
  onboardingComplete: boolean;
  /** The legacy handle, used to pre-fill old accounts. */
  handle: string | null;
  displayName: string | null;
};

export const EMPTY_ONBOARDING_STATE: OnboardingState = {
  complete: false,
  needsOnboarding: false,
  username: null,
  birthday: null,
  onboardingComplete: false,
  handle: null,
  displayName: null,
};

/** Normalize user input: strip a leading @, trim, lowercase. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export type UsernameCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Pure, synchronous username validation. Uniqueness is checked separately
 * against Supabase because it needs a network round-trip.
 */
export function validateUsername(raw: string, ownUsername?: string | null): UsernameCheck {
  const value = normalizeUsername(raw);
  if (!value) return { ok: false, error: "Pick a username" };
  if (value.length < USERNAME_MIN)
    return { ok: false, error: `Usernames need at least ${USERNAME_MIN} characters` };
  if (value.length > USERNAME_MAX)
    return { ok: false, error: `Usernames can be at most ${USERNAME_MAX} characters` };
  if (!/^[a-z0-9._]+$/.test(value))
    return { ok: false, error: "Use only letters, numbers, dots and underscores" };
  if (!/^[a-z0-9]/.test(value) || !/[a-z0-9]$/.test(value))
    return { ok: false, error: "Start and end with a letter or number" };
  if (/[._]{2,}/.test(value)) return { ok: false, error: "No double dots or underscores" };
  // The owner's own reserved handle is always allowed for that account.
  if (ownUsername && normalizeUsername(ownUsername) === value) return { ok: true, value };
  if (RESERVED_USERNAMES.has(value)) return { ok: false, error: "That username is reserved" };
  if (BOT_RE.test(value))
    return { ok: false, error: "That looks like a bot name — try something personal" };
  if (RANDOM_SEGMENTS_RE.test(value) && /\d/.test(value))
    return { ok: false, error: "That looks auto-generated — try something personal" };
  return { ok: true, value };
}

/** Whole years between a birthday (YYYY-MM-DD) and today. */
export function ageFromBirthday(birthday: string, today: Date = new Date()): number {
  const parts = birthday.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return -1;
  const [y, m, d] = parts as [number, number, number];
  let age = today.getFullYear() - y;
  const beforeBirthday =
    today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function validateBirthday(raw: string, today: Date = new Date()): string | null {
  const value = raw.trim();
  if (!value) return "Add your birthday";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Use a valid date";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Use a valid date";
  if (parsed.getTime() > today.getTime()) return "Birthday can't be in the future";
  if (ageFromBirthday(value, today) < MIN_AGE)
    return `You must be at least ${MIN_AGE} to use Coolerup`;
  return null;
}

/** True when a profile row still needs onboarding. */
export function profileNeedsOnboarding(
  profile:
    | { username?: string | null; birthday?: string | null; onboarding_complete?: boolean | null }
    | null
    | undefined,
): boolean {
  if (!profile) return false;
  return profile.onboarding_complete !== true || !profile.username || !profile.birthday;
}

/** Read onboarding fields for a signed-in user. Never throws. */
export async function fetchOnboardingState(userId: string): Promise<OnboardingState> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, birthday, onboarding_complete, handle, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return { ...EMPTY_ONBOARDING_STATE, needsOnboarding: !error };
  const row = data as {
    username: string | null;
    birthday: string | null;
    onboarding_complete: boolean | null;
    handle: string | null;
    display_name: string | null;
  };
  const complete = !!row.username && !!row.birthday && row.onboarding_complete === true;
  return {
    complete,
    needsOnboarding: !complete,
    username: row.username,
    birthday: row.birthday,
    onboardingComplete: row.onboarding_complete === true,
    handle: row.handle,
    displayName: row.display_name,
  };
}

export type AvailabilityResult = { available: boolean; error?: string; value?: string };

/**
 * Check the username against both `profiles.username` and the legacy
 * `profiles.handle` (so nobody can impersonate an old account's @handle), plus
 * the reserved list. The caller's own row is ignored.
 */
export async function checkUsernameAvailable(
  raw: string,
  userId: string,
  ownUsername?: string | null,
): Promise<AvailabilityResult> {
  const check = validateUsername(raw, ownUsername);
  if (!check.ok) return { available: false, error: check.error };
  const value = check.value;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, handle")
    .or(`username.ilike.${value},handle.eq.${value}`)
    .limit(10);
  if (error) return { available: false, error: "Couldn't check that username — try again" };

  const taken = (data ?? []).some((row: { id: string }) => row.id !== userId);
  if (taken) return { available: false, error: `@${value} is taken — try ${value}_1`, value };

  // Keep the owner's reserved handle for that same account.
  if (ownUsername && normalizeUsername(ownUsername) === value) return { available: true, value };

  // The reserved table is authoritative; fall back to the constant if it is
  // missing (e.g. migration not applied yet).
  const { data: reserved } = await supabase.rpc("is_reserved_username", { _username: value });
  if (reserved) return { available: false, error: "That username is reserved", value };

  return { available: true, value };
}

export type OnboardingInput = {
  username: string;
  birthday: string;
  displayName?: string;
  bio?: string;
  /** Stored reference, e.g. `avatars:<userId>/avatar.jpg`, or a plain URL. */
  avatarUrl?: string | null;
};

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Save onboarding for the signed-in user and mark the profile complete.
 *
 * Old accounts keep their existing `handle` (videos are keyed to user_id and
 * also display the stored handle text), so nothing they posted is orphaned.
 * Brand-new accounts with no videos get `handle = username` so their profile
 * URL matches the name they just chose.
 */
export async function saveOnboarding(
  user: Pick<User, "id">,
  input: OnboardingInput,
): Promise<SaveResult> {
  // Read the account's current names first: old accounts must be allowed to
  // keep their existing (possibly reserved) handle, and we need to know
  // whether they already have videos before touching `handle`.
  const { data: current } = await supabase
    .from("profiles")
    .select("handle, username")
    .eq("id", user.id)
    .maybeSingle();
  const currentRow = current as { handle: string | null; username: string | null } | null;
  const ownUsername = currentRow?.username ?? currentRow?.handle ?? null;

  const usernameCheck = validateUsername(input.username, ownUsername);
  if (!usernameCheck.ok) return { ok: false, error: usernameCheck.error };
  const username = usernameCheck.value;

  const birthdayError = validateBirthday(input.birthday);
  if (birthdayError) return { ok: false, error: birthdayError };

  const displayName = (input.displayName ?? "").trim();
  if (displayName.length > 60)
    return { ok: false, error: "Display name must be 60 characters or less" };
  const bio = (input.bio ?? "").trim();
  if (bio.length > 160) return { ok: false, error: "Bio must be 160 characters or less" };

  const availability = await checkUsernameAvailable(username, user.id, ownUsername);
  if (!availability.available)
    return { ok: false, error: availability.error ?? "Username unavailable" };

  // Does this account already have videos? If yes, it is an "old" account and
  // we must not change the handle their videos are displayed under.
  const { count } = await supabase
    .from("videos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const patch: {
    username: string;
    birthday: string;
    display_name: string | null;
    bio: string | null;
    onboarding_complete: boolean;
    avatar_url?: string | null;
    handle?: string;
  } = {
    username,
    birthday: input.birthday,
    display_name: displayName || null,
    bio: bio || null,
    onboarding_complete: true,
  };
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;
  if ((count ?? 0) === 0) patch.handle = username;

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select("id");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `@${username} is taken — try ${username}_1` };
    }
    return { ok: false, error: error.message || "Couldn't save your profile" };
  }

  // Rare: the profile row never got created (e.g. the auto-derived handle was
  // already taken at signup). Create it now so onboarding can finish.
  if (!updated || updated.length === 0) {
    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      handle: username,
      username,
      birthday: input.birthday,
      display_name: displayName || null,
      bio: bio || null,
      avatar_url: input.avatarUrl ?? null,
      onboarding_complete: true,
    });
    if (insertError) {
      if (insertError.code === "23505") {
        return { ok: false, error: `@${username} is taken — try ${username}_1` };
      }
      return { ok: false, error: insertError.message || "Couldn't save your profile" };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* "Complete your profile first" gate                                  */
/* ------------------------------------------------------------------ */

export const ONBOARDING_REQUIRED_EVENT = "loop-onboarding-required";

/** Open the "Complete username/birthday first" modal from anywhere. */
export function requireOnboarding() {
  window.dispatchEvent(new Event(ONBOARDING_REQUIRED_EVENT));
}
