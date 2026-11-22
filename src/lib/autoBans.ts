import { supabase } from "@/integrations/supabase/client";
import { inspectMedia } from "./nsfw";

/**
 * Auto Bans — the 3-strike ladder.
 *
 * `classifyText()` decides whether a piece of text breaks the rules and which
 * bucket it falls in. `moderate()` then hands the decision to the
 * `auto_moderate()` database function, which owns the actual ladder:
 *
 *   sexual   -> PERMANENT BAN immediately, on the first offence
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
  "porn",
  "porno",
  "pornhub",
  "xvideos",
  "xhamster",
  "onlyfans",
  "only fans",
  "nude",
  "nudes",
  "naked",
  "nakedness",
  "sex",
  "sexting",
  "sextape",
  "blowjob",
  "handjob",
  "rimjob",
  "cumshot",
  "cum",
  "jizz",
  "creampie",
  "dildo",
  "vibrator",
  "anal",
  "orgy",
  "threesome",
  "hentai",
  "nsfw",
  "xxx",
  "milf",
  "daddy dom",
  "strip tease",
  "striptease",
  "camgirl",
  "cam boy",
  "escort",
  "hookup",
  "send nudes",
  "nude pics",
  "nude selfie",
  "fuck me",
  "suck my",
  "jerking off",
  "masturbat*",
  "erotic",
  "fetish",
  "bdsm",
  "lingerie haul",
  "explicit",
  "pussy",
  "dick pic",
  "dick pics",
  "cock pic",
  "boob",
  "boobs",
  "titty",
  "titties",
  "tits",
  "horny",
  "sext",
  "sex tape",
  "sex video",
  "sex vid",
  "nude video",
  "nudes video",
  "cum video",
  "xxx video",
  "adult content",
  "porn video",
  "pornhub link",
  "fuck video",
  "squirting",
  "orgasm",
  "clit",
  "penis",
  "vagina",
  "anus",
  "nipple",
  "nipples",
  "stripper",
  "strip club",
  "webcam sex",
  "snap for nudes",
  "kik for nudes",
  "trade nudes",
];

/** Bullying, hate and dehumanising language. */
const BULLYING = [
  "retard",
  "retarded",
  "spastic",
  "mongoloid",
  "tranny",
  "faggot",
  "fag",
  "dyke",
  "nigger",
  "nigga",
  "coon",
  "chink",
  "gook",
  "spic",
  "wetback",
  "kike",
  "paki",
  "raghead",
  "towelhead",
  "sandnigger",
  "beaner",
  "cripple",
  "fatass",
  "fat ass",
  "lardass",
  "ugly bitch",
  "worthless",
  "kill yourself",
  "kys",
  "go die",
  "nobody loves you",
  "no one loves you",
  "you should die",
  "subhuman",
  "vermin",
  "freak",
  "loser",
  "waste of space",
  "waste of air",
  "unwanted",
  "kill urself",
  "end yourself",
  "drink bleach",
  "stupid",
  "stupidest",
  "idiot",
  "idiotic",
  "moron",
  "moronic",
  "imbecile",
  "dumbass",
  "dumb ass",
  "dumbest",
  "dumb bitch",
  "stupid bitch",
  "bitch",
  "bitches",
  "son of a bitch",
  "bastard",
  "whore",
  "whores",
  "slut",
  "sluts",
  "skank",
  "hoe",
  "thot",
  "cunt",
  "prick",
  "douche",
  "douchebag",
  "scumbag",
  "trash human",
  "human trash",
  "pathetic",
  "pathetic loser",
  "shut up",
  "shut your mouth",
  "nobody cares",
  "no one cares",
  "nobody asked",
  "no one asked",
  "nobody likes you",
  "no one likes you",
  "everyone hates you",
  "you have no friends",
  "youre worthless",
  "you are worthless",
  "youre nothing",
  "you are nothing",
  "youre a joke",
  "you are a joke",
  "ugly",
  "ugliest",
  "disgusting",
  "go away forever",
  "hope you die",
  "hope you get",
  "unalive yourself",
  "off yourself",
  "hang yourself",
  "go hang",
  "slit your wrists",
  "cut yourself",
  "you should be dead",
  "better off dead",
  "no one would miss you",
  "nobody would miss you",
  "go cry",
  "cry about it",
  "touch grass",
  "neck yourself",
];

/** Direct threats of violence. */
const THREATS = [
  "i will kill",
  "i'll kill",
  "im gonna kill",
  "i'm gonna kill",
  "i will hurt",
  "i'll hurt",
  "i will find you",
  "i know where you live",
  "watch your back",
  "you're dead",
  "youre dead",
  "ur dead",
  "you are dead",
  "i will shoot",
  "i'll shoot",
  "i will stab",
  "i'll stab",
  "bomb your",
  "i will rape",
  "i'll rape",
  "rape you",
  "beat you up",
  "jump you",
  "hunt you down",
  "come for you",
  "put you in the ground",
  "slit your throat",
  "break your neck",
  "smash your face",
];

/** Spam / scam patterns. */
const SPAM_PHRASES = [
  "follow for follow",
  "f4f",
  "l4l",
  "follow back",
  "follow4follow",
  "free followers",
  "free likes",
  "free coins",
  "free diamonds",
  "cash app",
  "cashapp",
  "venmo me",
  "paypal me",
  "send money",
  "dm me to earn",
  "dm for promo",
  "check my bio",
  "link in bio for money",
  "click the link",
  "click here to win",
  "you have won",
  "you've won",
  "claim your prize",
  "crypto giveaway",
  "bitcoin giveaway",
  "double your",
  "make money",
  "make cash",
  "make money fast",
  "work from home",
  "investment opportunity",
  "guaranteed profit",
  "telegram me",
  "whatsapp me",
  "text me at",
  "dm me",
  "dms open",
  "buy followers",
  "cheap followers",
  "followers for sale",
  "selling followers",
  "get followers",
  "gain followers",
  "real followers",
  "1000 followers",
  "10k followers",
  "sub for sub",
  "sub4sub",
  "like for like",
  "like4like",
  "comment for comment",
  "c4c",
  "earn money online",
  "earn from home",
  "passive income",
  "financial freedom",
  "get rich quick",
  "click my link",
  "link in bio",
  "check the link",
  "promo link",
  "promoting my",
  "promo available",
  "advertising space",
  "dm for collab",
  "dm for promo",
  "dm for price",
  "dm for details",
  "serious buyers only",
  "no refunds",
  "limited offer",
  "act fast",
  "first 100 people",
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

/**
 * Find needles in the normalised haystack.
 *
 * Matching is word-exact by default. The old version also accepted a bare
 * prefix, which meant "anal" fired on "analysis", "spic" on "spicy" and "paki"
 * on "Pakistan" — innocent captions were being deleted and the account was
 * taking a strike for them. Entries that genuinely want prefix matching end in
 * `*` ("masturbat*"), and everything else has to be a whole word.
 */
function hits(haystack: string, needles: string[]): string[] {
  const found: string[] = [];
  for (const needle of needles) {
    const prefix = needle.endsWith("*");
    const n = normalize(prefix ? needle.slice(0, -1) : needle).trim();
    if (!n) continue;
    if (prefix ? haystack.includes(` ${n}`) : haystack.includes(` ${n} `)) found.push(needle);
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
    return {
      kind: "bullying",
      reason: `Bullying or hate speech: ${bullying[0]}`,
      matches: bullying,
    };
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

/**
 * Screen text *before* it is written.
 *
 * Use this on surfaces the database ladder cannot delete from (group posts,
 * group comments, long-form comments, group names). The strike is recorded with
 * `contentType: "none"` and the caller refuses the insert, so nothing has to be
 * cleaned up afterwards and no new content types are needed in SQL.
 *
 * Returns the strike result when the text is blocked, or null when it is clean.
 */
export async function screenBeforeWrite(opts: {
  userId: string;
  username: string;
  text: string | null | undefined;
}): Promise<StrikeResult | null> {
  const classification = classifyText(opts.text);
  if (!classification) return null;
  const result = await moderate({
    userId: opts.userId,
    username: opts.username,
    classification,
    contentType: "none",
    contentId: null,
  });
  if (result.strike > 0) emitStrike(result);
  return result;
}

/**
 * Record an explicit-media hit found by the on-device image classifier.
 *
 * This is the one path that skips the 3-strike ladder: `auto_moderate` treats
 * `kind = 'sexual'` as an instant permanent ban, so a single naked upload ends
 * the account. The content was never written (the caller blocks the upload), so
 * there is no row for the database to delete — `contentType: "none"`.
 *
 * The popup is raised even when the RPC is missing, because the upload is
 * blocked locally either way and the poster needs to see why.
 */
export async function reportExplicitMedia(opts: {
  userId: string;
  username: string;
  source: "video" | "photo";
  score: number;
}): Promise<StrikeResult> {
  const classification: Classification = {
    kind: "sexual",
    reason: `Explicit sexual content detected in ${opts.source} (${Math.round(opts.score * 100)}% confidence)`,
    matches: [],
  };
  const result = await moderate({
    userId: opts.userId,
    username: opts.username,
    classification,
    contentType: "none",
    contentId: null,
  });
  if (result.strike > 0) {
    emitStrike(result);
    return result;
  }
  // Moderation RPCs are not installed. The media is still refused; show the
  // ban popup so the poster is not left guessing why the upload vanished.
  const local: StrikeResult = {
    ok: true,
    strike: 3,
    action: "ban",
    permanent: true,
    muted_until: null,
    deleted: false,
    message:
      "Explicit sexual content is not allowed on Coolerup. Your account is permanently banned.",
    error: result.error,
  };
  emitStrike(local);
  return local;
}

/**
 * Is the ladder actually installed in this database?
 *
 * Returns false when `my_strike_status()` is missing, which is what happens
 * when `supabase/sql-editor-auto-bans.sql` has never been run. Without this
 * check every violation fails silently: the RPC errors, `moderate()` returns
 * strike 0, and no popup appears — indistinguishable from "the text was fine".
 */
export async function moderationAvailable(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("my_strike_status");
    return !error;
  } catch {
    return false;
  }
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

export async function ownerUnban(
  username: string,
): Promise<{ ok: boolean; error?: string | undefined }> {
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

/**
 * Re-scan videos that are already published.
 *
 * The upload check only protects *new* posts, so anything explicit that was
 * already in the feed before the classifier existed just sits there. This walks
 * the most recent videos, pulls each file back down, runs the same on-device
 * classifier over it, and asks `auto_moderate` to remove the row and ban the
 * owner when it is explicit.
 *
 * Admin-only by construction: `auto_moderate` refuses to moderate another user
 * unless the caller has the admin role.
 */
export type ScanHit = {
  videoId: string;
  username: string;
  score: number;
  removed: boolean;
  banned: boolean;
  error?: string;
};

export type ScanReport = {
  scanned: number;
  skipped: number;
  hits: ScanHit[];
  failed: number;
};

export async function scanPublishedVideos(
  opts: {
    limit?: number;
    onProgress?: ((done: number, total: number) => void) | undefined;
  } = {},
): Promise<ScanReport> {
  const limit = opts.limit ?? 30;
  const report: ScanReport = { scanned: 0, skipped: 0, hits: [], failed: 0 };

  const { data, error } = await supabase
    .from("videos")
    .select("id, username, user_id, video_url")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as {
    id: string;
    username: string | null;
    user_id: string | null;
    video_url: string | null;
  }[];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    opts.onProgress?.(i, rows.length);
    if (!row.video_url || !row.user_id) {
      report.skipped++;
      continue;
    }
    let blob: Blob;
    try {
      const res = await fetch(row.video_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
    } catch (e) {
      console.error("[scan] could not download video", row.id, e);
      report.failed++;
      continue;
    }
    const verdict = await inspectMedia(blob);
    report.scanned++;
    if (!verdict) {
      report.skipped++;
      continue;
    }
    if (!verdict.explicit) continue;

    const result = await moderate({
      userId: row.user_id,
      username: row.username ?? "unknown",
      classification: {
        kind: "sexual",
        reason: `Explicit sexual content detected in published video (${Math.round(verdict.score * 100)}% confidence)`,
        matches: [],
      },
      contentType: "video",
      contentId: row.id,
    });
    report.hits.push({
      videoId: row.id,
      username: row.username ?? "unknown",
      score: verdict.score,
      removed: result.deleted,
      banned: result.permanent,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  opts.onProgress?.(rows.length, rows.length);
  return report;
}
