import { supabase } from "@/integrations/supabase/client";

/**
 * Auto Bans — the 3-strike ladder.
 *
 * `classifyText()` decides whether a piece of text breaks the rules and which
 * bucket it falls in. `moderate()` then hands the decision to the
 * `auto_moderate()` database function, which owns the actual ladder:
 *
 *   strike 1 -> warning + content removed
 *   strike 2 -> warning + content removed + 24h mute
 *   strike 3 -> warning + PERMANENT BAN (+ email / phone / device burned)
 *
 * The ladder lives in Postgres on purpose. A client-side counter would reset
 * every time someone cleared local storage.
 */

export type ViolationKind = "sexual" | "bullying" | "threat" | "spam" | "other";

export type Classification = {
  kind: ViolationKind;
  /** Human-readable, shown in the warning popup and stored on the ban record. */
  reason: string;
  /** The exact words that tripped the filter, for the admin log. */
  matches: string[];
};

export type StrikeResult = {
  ok: boolean;
  strike: number;
  action: "warn" | "mute" | "ban" | "banned" | "none";
  permanent: boolean;
  muted_until: string | null;
  deleted: boolean;
  message: string;
  error?: string | undefined;
};

export type StrikeStatus = {
  strike_count: number;
  muted: boolean;
  muted_until: string | null;
  is_permanent: boolean;
  last_reason: string | null;
  last_kind: string | null;
};

export type BanListRow = {
  id: string;
  username: string;
  user_id: string | null;
  kind: string;
  reason: string | null;
  strike_count: number;
  last_kind: string | null;
  last_content_type: string | null;
  is_permanent: boolean;
  auto: boolean;
  banned_by: string | null;
  expires_at: string | null;
  created_at: string;
  active: boolean;
  identity_count: number;
};

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

/** Explicit sexual content. Kept deliberately narrow — anatomy in a medical
 *  or educational caption should not nuke an account. */
const SEXUAL = [
  "porn", "porno", "pornhub", "xvideos", "xhamster", "onlyfans", "only fans",
  "nude", "nudes", "naked", "nakedness", "sex", "sexting", "sextape", "blowjob",
  "handjob", "rimjob", "cumshot", "cum", "jizz", "creampie", "dildo", "vibrator",
  "anal", "orgy", "threesome", "hentai", "nsfw", "xxx", "milf", "daddy dom",
  "strip tease", "striptease", "camgirl", "cam boy", "escort", "hookup",
  "send nudes", "nude pics", "nude selfie", "fuck me", "suck my", "jerking off",
  "masturbat", "erotic", "fetish", "bdsm", "lingerie haul",
];

/** Bullying, hate and dehumanising language. */
const BULLYING = [
  "retard", "retarded", "spastic", "mongoloid", "tranny", "faggot", "fag",
  "dyke", "nigger", "nigga", "coon", "chink", "gook", "spic", "wetback",
  "kike", "paki", "raghead", "towelhead", "sandnigger", "beaner", "cripple",
  "fatass", "fat ass", "lardass", "ugly bitch", "worthless", "kill yourself",
  "kys", "go die", "nobody loves you", "no one loves you", "you should die",
  "subhuman", "vermin", "freak", "loser", "waste of space", "waste of air",
  "unwanted", "kill urself", "end yourself", "drink bleach",
];

/** Direct threats of violence. */
const THREATS = [
  "i will kill", "i'll kill", "im gonna kill", "i'm gonna kill",
  "i will hurt", "i'll hurt", "i will find you", "i know where you live",
  "watch your back", "you're dead", "youre dead", "ur dead", "you are dead",
  "i will shoot", "i'll shoot", "i will stab", "i'll stab", "bomb your",
  "i will rape", "i'll rape", "rape you", "beat you up", "jump you",
  "hunt you down", "come for you", "put you in the ground",
  "slit your throat", "break your neck", "smash your face",
];

/** Spam / scam patterns. */
const SPAM_PHRASES = [
  "follow for follow", "f4f", "l4l", "follow back", "follow4follow",
  "free followers", "free likes", "free coins", "free diamonds",
  "cash app", "cashapp", "venmo me", "paypal me", "send money",
  "dm me to earn", "dm for promo", "check my bio", "link in bio for money",
  "click the link", "click here to win", "you have won", "you've won",
  "claim your prize", "crypto giveaway", "bitcoin giveaway", "double your",
  "make $", "make money fast", "work from home", "investment opportunity",
  "guaranteed profit", "telegram me", "whatsapp me", "text me at",
];

const SPAM_URL_RE = /(https?:\/\/|www\.)\S+/gi;
const REPEAT_CHAR_RE = /(.)\1{6,}/;

/** Fold leetspeak and strip punctuation so `p0rn` and `p.o.r.n` both hit. */
function normalize(text: string): string {
  return (
    " " +
    text
      .toLowerCase()
      .replace(/[0@]/g, "o")
      .replace(/[1!|]/g, "i")
      .replace(/3/g, "e")
      .replace(/4/g, "a")
      .replace(/5|\$/g, "s")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " "
  );
}

function hits(haystack: string, needles: string[]): string[] {
  const found: string[] = [];
  for (const needle of needles) {
    const n = normalize(needle).trim();
    if (!n) continue;
    if (haystack.includes(` ${n} `) || haystack.includes(` ${n}`)) found.push(needle);
  }
  return found;
}

/**
 * Decide whether text breaks the rules.
 *
 * Order matters: a threat is worse than spam, sexual content is worse than
 * bullying-adjacent profanity. The first bucket that matches wins so the
 * reason shown to the user is the most serious one.
 */
export function classifyText(raw: string | null | undefined): Classification | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const n = normalize(text);

  const threats = hits(n, THREATS);
  if (threats.length) {
    return { kind: "threat", reason: `Threat of violence: ${threats[0]}`, matches: threats };
  }

  const sexual = hits(n, SEXUAL);
  if (sexual.length) {
    return { kind: "sexual", reason: `Sexual or explicit content: ${sexual[0]}`, matches: sexual };
  }

  const bullying = hits(n, BULLYING);
  if (bullying.length) {
    return { kind: "bullying", reason: `Bullying or hate speech: ${bullying[0]}`, matches: bullying };
  }

  const spamPhrases = hits(n, SPAM_PHRASES);
  const links = text.match(SPAM_URL_RE) ?? [];
  const spammy =
    spamPhrases.length > 0 ||
    links.length >= 3 ||
    REPEAT_CHAR_RE.test(text) ||
    (links.length > 0 && /free|win|prize|money|coin|follower/i.test(text));

  if (spammy) {
    return {
      kind: "spam",
      reason: spamPhrases.length
        ? `Spam: ${spamPhrases[0]}`
        : links.length >= 3
          ? "Spam: too many links"
          : "Spam: repeated or promotional text",
      matches: spamPhrases.length ? spamPhrases : links.slice(0, 3),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

const DEVICE_KEY = "coolerup:device-id";

/** A stable per-install id. Not a fingerprint — just something the ban table
 *  can key on so a reinstall on the same phone is still recognised. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

/** Tell the database which device this account is on. Called once per session. */
export async function registerDevice(): Promise<void> {
  const deviceId = getDeviceId();
  if (!deviceId) return;
  try {
    await supabase.rpc("register_device", { p_device_id: deviceId });
  } catch {
    // Non-fatal. A missing device row just means the ban burns one fewer id.
  }
}

/** Signup gate. Returns the ban message when this device/email/phone is burned. */
export async function checkIdentityBan(
  kind: "device" | "email" | "phone",
  value: string,
): Promise<{ banned: boolean; message?: string | undefined; reason?: string | undefined }> {
  if (!value) return { banned: false };
  try {
    const { data, error } = await supabase.rpc("check_identity_ban", {
      p_kind: kind,
      p_value: value,
    });
    if (error) return { banned: false };
    const row = (data ?? {}) as { banned?: boolean; message?: string; reason?: string };
    return { banned: Boolean(row.banned), message: row.message, reason: row.reason };
  } catch {
    return { banned: false };
  }
}

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

/**
 * Run the ladder for one piece of content.
 *
 * Call this *after* the content is written (or instead of writing it, when the
 * text is obviously bad). `contentId` lets the database delete the row it just
 * created; pass `null` when you blocked the write before it happened.
 */
export async function moderate(opts: {
  userId: string;
  username: string;
  classification: Classification;
  contentType?: "video" | "comment" | "profile_pic" | "none";
  contentId?: string | null;
}): Promise<StrikeResult> {
  const { userId, username, classification, contentType = "none", contentId = null } = opts;

  const fallback: StrikeResult = {
    ok: false,
    strike: 0,
    action: "none",
    permanent: false,
    muted_until: null,
    deleted: false,
    message: "",
    error: "moderation_unavailable",
  };

  try {
    const { data, error } = await supabase.rpc("auto_moderate", {
      p_user_id: userId,
      p_username: username,
      p_kind: classification.kind,
      p_reason: classification.reason,
      p_content_type: contentType,
      p_content_id: contentId,
    });
    if (error) {
      console.error("auto_moderate failed", error);
      return { ...fallback, error: error.message ?? "moderation_unavailable" };
    }
    const row = (data ?? {}) as Partial<StrikeResult>;
    return {
      ok: Boolean(row.ok),
      strike: Number(row.strike ?? 0),
      action: (row.action as StrikeResult["action"]) ?? "none",
      permanent: Boolean(row.permanent),
      muted_until: row.muted_until ?? null,
      deleted: Boolean(row.deleted),
      message: row.message ?? "",
      error: row.error,
    };
  } catch (e) {
    console.error("auto_moderate threw", e);
    return fallback;
  }
}

/**
 * Strike bus.
 *
 * `screenContent` runs from plain modules (`src/lib/loop.ts`) as well as from
 * React components. Those modules cannot reach a context provider, so every
 * strike is broadcast here and `WarningProvider` listens once and owns the
 * popup. This keeps the write paths free of UI concerns.
 */
type StrikeListener = (result: StrikeResult) => void;
const strikeListeners = new Set<StrikeListener>();

export function onStrike(fn: StrikeListener): () => void {
  strikeListeners.add(fn);
  return () => {
    strikeListeners.delete(fn);
  };
}

function emitStrike(result: StrikeResult) {
  for (const fn of strikeListeners) {
    try {
      fn(result);
    } catch {
      // A broken listener must never break the write path.
    }
  }
}

/** Convenience: classify then moderate in one call. Returns null when clean. */
export async function screenContent(opts: {
  userId: string;
  username: string;
  text: string | null | undefined;
  contentType?: "video" | "comment" | "profile_pic" | "none";
  contentId?: string | null;
}): Promise<StrikeResult | null> {
  const classification = classifyText(opts.text);
  if (!classification) return null;
  const result = await moderate({
    userId: opts.userId,
    username: opts.username,
    classification,
    contentType: opts.contentType ?? "none",
    contentId: opts.contentId ?? null,
  });
  if (result.strike > 0) emitStrike(result);
  return result;
}

export async function myStrikeStatus(): Promise<StrikeStatus> {
  const empty: StrikeStatus = {
    strike_count: 0,
    muted: false,
    muted_until: null,
    is_permanent: false,
    last_reason: null,
    last_kind: null,
  };
  try {
    const { data, error } = await supabase.rpc("my_strike_status");
    if (error) return empty;
    return { ...empty, ...((data ?? {}) as Partial<StrikeStatus>) };
  } catch {
    return empty;
  }
}

/** True while a 24-hour mute from strike 2 is still running. */
export async function isMutedNow(): Promise<{ muted: boolean; until: string | null }> {
  const s = await myStrikeStatus();
  return { muted: s.muted, until: s.muted_until };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function adminBanList(): Promise<BanListRow[]> {
  try {
    const { data, error } = await supabase.rpc("admin_ban_list");
    if (error) return [];
    return (data ?? []) as BanListRow[];
  } catch {
    return [];
  }
}

export async function amIOwner(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_owner");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export async function ownerUnban(username: string): Promise<{ ok: boolean; error?: string | undefined }> {
  try {
    const { data, error } = await supabase.rpc("owner_unban", { p_username: username });
    if (error) return { ok: false, error: error.message };
    const row = (data ?? {}) as { ok?: boolean; error?: string };
    return { ok: Boolean(row.ok), error: row.error };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const VIOLATION_LABEL: Record<ViolationKind, string> = {
  sexual: "Sexual / explicit",
  bullying: "Bullying / hate",
  threat: "Threat",
  spam: "Spam",
  other: "Other",
};
