import { supabase } from "@/integrations/supabase/client";

/** Words and phrases that block a comment or message. Admins can add more via muted words. */
export const BANNED_WORDS = [
  // profanity
  "fuck",
  "fucker",
  "fucking",
  "fucked",
  "motherfucker",
  "mf",
  "fck",
  "fuk",
  "fking",
  "shit",
  "shitty",
  "bullshit",
  "bitch",
  "bitches",
  "biatch",
  "bastard",
  "asshole",
  "arsehole",
  "dickhead",
  "dick",
  "cock",
  "cocksucker",
  "prick",
  "pussy",
  "cunt",
  "twat",
  "wanker",
  "douche",
  "douchebag",
  "jackass",
  "dumbass",
  "piss",
  "pissed",
  "bollocks",
  "slut",
  "slutty",
  "whore",
  "hoe",
  "skank",
  "thot",
  // sexual
  "porn",
  "porno",
  "pornhub",
  "xxx",
  "nude",
  "nudes",
  "naked",
  "sex",
  "sexting",
  "blowjob",
  "handjob",
  "rimjob",
  "cum",
  "cumshot",
  "jizz",
  "orgasm",
  "masturbate",
  "masturbating",
  "dildo",
  "vibrator",
  "boobs",
  "tits",
  "titties",
  "nipples",
  "anal",
  "horny",
  "milf",
  "hentai",
  "onlyfans",
  "camgirl",
  "escort",
  "hooker",
  "stripper",
  "fetish",
  "bdsm",
  "erection",
  "boner",
  "penis",
  "vagina",
  "genitals",
  "deepthroat",
  "gangbang",
  "threesome",
  "nsfw",
  // slurs and hate
  "nigger",
  "nigga",
  "niggas",
  "negro",
  "chink",
  "gook",
  "spic",
  "wetback",
  "kike",
  "beaner",
  "coon",
  "jigaboo",
  "raghead",
  "towelhead",
  "paki",
  "faggot",
  "fag",
  "dyke",
  "tranny",
  "retard",
  "retarded",
  "spaz",
  "cripple",
  "nazi",
  "heil hitler",
  "white power",
  "kkk",
  // harassment and violence
  "kys",
  "kill yourself",
  "go die",
  "neck yourself",
  "hang yourself",
  "i will kill you",
  "rape",
  "rapist",
  "molest",
  "pedo",
  "pedophile",
  "loli",
  "shoot up",
  "bomb threat",
  // scams and spam
  "free money",
  "send nudes",
  "cashapp me",
  "dm for promo",
  "crypto giveaway",
  "double your money",
  "click my link",
  "buy followers",
  "free followers",
  "sugar daddy",
  "telegram me",
];

let extra: string[] = [];
let loaded = false;
async function loadMutedWords() {
  if (loaded) return;
  loaded = true;
  const { data } = await supabase.from("muted_words").select("word");
  extra = (data ?? []).map((r) => r.word.toLowerCase());
}

const normalize = (t: string) =>
  ` ${t
    .toLowerCase()
    .replace(/[0@]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")} `;

export function containsBannedWord(text: string) {
  const t = normalize(text);
  return [...BANNED_WORDS, ...extra].some((w) => t.includes(` ${w} `));
}

const SENT_KEY = "loop-sent";
type Sent = { t: number; text: string };
const recent = (): Sent[] => {
  try {
    const all = JSON.parse(localStorage.getItem(SENT_KEY) || "[]") as Sent[];
    return all.filter((s) => Date.now() - s.t < 60_000);
  } catch {
    return [];
  }
};

/** True when the same text was already sent 4 times in the last minute (this would be the 5th). */
export function isSpam(text: string) {
  const t = text.trim().toLowerCase();
  return recent().filter((s) => s.text === t).length >= 4;
}

export function isRateLimited() {
  return recent().length >= 10;
}

export function recordSent(text: string) {
  localStorage.setItem(
    SENT_KEY,
    JSON.stringify([...recent(), { t: Date.now(), text: text.trim().toLowerCase() }]),
  );
}

/** Returns an error to show, or null if the text may be sent. */
export async function checkOutgoing(text: string): Promise<string | null> {
  await loadMutedWords().catch(() => {});
  if (containsBannedWord(text) || isSpam(text)) return "Message blocked by safety filter";
  if (isRateLimited()) return "Slow down — you can send 10 messages a minute";
  return null;
}

export const RULES = [
  ["No nudity or sexual content", "Keep it clothed. No porn, sexual acts, or sexual solicitation."],
  [
    "No sexual content involving minors",
    "Zero tolerance. Accounts are banned permanently and reported.",
  ],
  ["No harassment or bullying", "Don't target, threaten, or pile on anyone."],
  [
    "No hate",
    "No attacks on anyone for race, religion, gender, sexuality, disability, or where they're from.",
  ],
  ["No violence", "No threats, gore, or encouraging anyone to hurt themselves or others."],
  ["No spam or scams", "No repeated messages, fake giveaways, or shady links."],
] as const;

/* -------------------------------------------------------------------------- */
/*  TikTok-style auto moderation                                              */
/*                                                                            */
/*  Auto-bans are DISABLED. Reports are recorded and shown in /admin, but     */
/*  nothing bans or mutes a user automatically — you decide.                   */
/*  The only automatic action left is hiding a single video whose caption      */
/*  trips the banned-word filter.                                             */
/* -------------------------------------------------------------------------- */

/** Report categories, in TikTok's order. */
export const REPORT_REASONS = [
  { id: "violence", label: "Violence", hint: "Threats, gore, or encouraging harm" },
  { id: "hate", label: "Hate speech", hint: "Attacks based on who someone is" },
  { id: "nudity", label: "Nudity", hint: "Sexual content or exposure" },
  { id: "spam", label: "Spam", hint: "Fake giveaways, repeated posts, shady links" },
  { id: "harassment", label: "Harassment", hint: "Bullying or targeting someone" },
  { id: "minor", label: "Minor safety", hint: "Anyone under 18 in danger" },
  { id: "illegal", label: "Illegal activity", hint: "Drugs, weapons, stolen goods" },
  { id: "other", label: "Other", hint: "Something else that breaks the rules" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export type ModerationResult = {
  ok: boolean;
  banned?: boolean | undefined;
  action?: string | null | undefined;
  expires_at?: string | null | undefined;
  duplicate?: boolean | undefined;
  error?: string | undefined;
};

const unwrap = <T>(data: unknown): T | null => {
  if (Array.isArray(data)) return (data[0] ?? null) as T | null;
  return (data ?? null) as T | null;
};

/** True when this handle is currently banned (24h / 7d / permanent). */
export async function checkIfBanned(username: string): Promise<boolean> {
  const handle = username.replace(/^@+/, "").trim();
  if (!handle) return false;
  try {
    const { data, error } = await supabase.rpc("is_banned_username", { _username: handle });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * Auto-bans are disabled — this always returns `{ ok: true, banned: false }`.
 * It is kept so existing callers keep compiling; banning is now manual, from
 * the buttons in /admin.
 */
export async function autoBanIfNeeded(
  userId: string | null,
  username: string,
): Promise<ModerationResult> {
  const handle = username.replace(/^@+/, "").trim();
  if (!handle) return { ok: false, error: "Unknown user" };
  try {
    const { data, error } = await supabase.rpc("auto_ban_if_needed", {
      _user_id: userId,
      _username: handle,
    });
    if (error) return { ok: false, error: error.message };
    const row = unwrap<Record<string, unknown>>(data) ?? {};
    return {
      ok: true,
      banned: Boolean(row["applied"]),
      action: (row["action"] as string | undefined) ?? null,
      expires_at: (row["expires_at"] as string | undefined) ?? null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}

/** Same word list the database seeds into `banned_words`. */
export function hasBannedWords(text: string | null | undefined): boolean {
  if (!text) return false;
  return containsBannedWord(text);
}

/** Words that tripped the filter, for the "why was this hidden" copy. */
export function bannedWordsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const t = normalize(text);
  return [...BANNED_WORDS, ...extra].filter((w) => t.includes(` ${w} `));
}

/**
 * Report a video. Inserts the report, then lets the database decide whether the
 * author has crossed an auto-ban threshold. One report per person per video per
 * reason every 7 days, so a single user can't trigger a ban alone.
 */
export async function reportContent(
  videoId: string | null,
  reportedUsername: string,
  reason: ReportReason,
  details?: string,
): Promise<ModerationResult> {
  try {
    const { data, error } = await supabase.rpc("report_content", {
      _video_id: videoId,
      _reported_username: reportedUsername.replace(/^@+/, "").trim(),
      _reason: reason,
      _details: details?.trim() ? details.trim().slice(0, 1000) : null,
    });
    if (error) return { ok: false, error: error.message };
    const row = unwrap<Record<string, unknown>>(data) ?? {};
    return {
      ok: Boolean(row["ok"]),
      banned: Boolean(row["banned"]),
      action: (row["action"] as string | undefined) ?? null,
      expires_at: (row["expires_at"] as string | undefined) ?? null,
      duplicate: Boolean(row["duplicate"]),
      error: (row["error"] as string | undefined) ?? undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not send report" };
  }
}

/** True when this handle is currently muted (comment spam). */
export async function isMuted(username: string): Promise<boolean> {
  const handle = username.replace(/^@+/, "").trim();
  if (!handle) return false;
  try {
    const { data, error } = await supabase.rpc("is_muted", { _username: handle });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/* ------------------------------- admin ---------------------------------- */

export async function amIAdmin(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("am_i_admin");
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

export type AdminReport = {
  id: string;
  video_id: string | null;
  reported_video_id: string | null;
  reporter_username: string;
  reported_username: string;
  reported_user_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  action_taken: string | null;
  created_at: string;
};

export type AdminBan = {
  id: string;
  username: string;
  user_id: string | null;
  reason: string | null;
  banned_by: string | null;
  kind: string;
  is_permanent: boolean;
  expires_at: string | null;
  auto: boolean;
  report_count: number | null;
  created_at: string;
  active: boolean;
};

export type ModerationLogRow = {
  id: string;
  username: string | null;
  action: string;
  reason: string | null;
  report_count: number | null;
  is_permanent: boolean;
  expires_at: string | null;
  auto: boolean;
  actor: string | null;
  created_at: string;
};

export async function adminReports(limit = 100): Promise<AdminReport[]> {
  const { data, error } = await supabase.rpc("admin_reports", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminReport[];
}

export async function adminBans(): Promise<AdminBan[]> {
  const { data, error } = await supabase.rpc("admin_bans");
  if (error) throw error;
  return (data ?? []) as AdminBan[];
}

export async function adminModerationLog(limit = 100): Promise<ModerationLogRow[]> {
  const { data, error } = await supabase.rpc("admin_moderation_log", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as ModerationLogRow[];
}

export async function adminBan(
  username: string,
  hours: number | null,
  permanent: boolean,
  reason = "Manual ban by admin",
): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_ban", {
    _username: username.replace(/^@+/, "").trim(),
    _hours: hours,
    _permanent: permanent,
    _reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  const row = unwrap<Record<string, unknown>>(data) ?? {};
  return {
    ok: Boolean(row["ok"]),
    banned: Boolean(row["applied"]),
    error: row["error"] as string | undefined,
  };
}

export async function adminUnban(username: string): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_unban", {
    _username: username.replace(/^@+/, "").trim(),
  });
  if (error) return { ok: false, error: error.message };
  const row = unwrap<Record<string, unknown>>(data) ?? {};
  return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
}

export async function adminDismissReport(reportId: string): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_dismiss_report", { _report_id: reportId });
  if (error) return { ok: false, error: error.message };
  const row = unwrap<Record<string, unknown>>(data) ?? {};
  return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
}

export async function adminUnhideVideo(videoId: string): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_unhide_video", { _video_id: videoId });
  if (error) return { ok: false, error: error.message };
  const row = unwrap<Record<string, unknown>>(data) ?? {};
  return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
}
