import { supabase } from "@/integrations/supabase/client";

/** Words and phrases that block a comment or message. Admins can add more via muted words. */
export const BANNED_WORDS = [
  // profanity
  "fuck", "fucker", "fucking", "fucked", "motherfucker", "mf", "fck", "fuk", "fking", "shit", "shitty", "bullshit",
  "bitch", "bitches", "biatch", "bastard", "asshole", "arsehole", "dickhead", "dick", "cock", "cocksucker", "prick",
  "pussy", "cunt", "twat", "wanker", "douche", "douchebag", "jackass", "dumbass", "piss", "pissed", "bollocks",
  "slut", "slutty", "whore", "hoe", "skank", "thot",
  // sexual
  "porn", "porno", "pornhub", "xxx", "nude", "nudes", "naked", "sex", "sexting", "blowjob", "handjob", "rimjob",
  "cum", "cumshot", "jizz", "orgasm", "masturbate", "masturbating", "dildo", "vibrator", "boobs", "tits", "titties",
  "nipples", "anal", "horny", "milf", "hentai", "onlyfans", "camgirl", "escort", "hooker", "stripper", "fetish",
  "bdsm", "erection", "boner", "penis", "vagina", "genitals", "deepthroat", "gangbang", "threesome", "nsfw",
  // slurs and hate
  "nigger", "nigga", "niggas", "negro", "chink", "gook", "spic", "wetback", "kike", "beaner", "coon", "jigaboo",
  "raghead", "towelhead", "paki", "faggot", "fag", "dyke", "tranny", "retard", "retarded", "spaz", "cripple",
  "nazi", "heil hitler", "white power", "kkk",
  // harassment and violence
  "kys", "kill yourself", "go die", "neck yourself", "hang yourself", "i will kill you", "rape", "rapist", "molest",
  "pedo", "pedophile", "loli", "shoot up", "bomb threat",
  // scams and spam
  "free money", "send nudes", "cashapp me", "dm for promo", "crypto giveaway", "double your money", "click my link",
  "buy followers", "free followers", "sugar daddy", "telegram me",
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
  localStorage.setItem(SENT_KEY, JSON.stringify([...recent(), { t: Date.now(), text: text.trim().toLowerCase() }]));
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
  ["No sexual content involving minors", "Zero tolerance. Accounts are banned permanently and reported."],
  ["No harassment or bullying", "Don't target, threaten, or pile on anyone."],
  ["No hate", "No attacks on anyone for race, religion, gender, sexuality, disability, or where they're from."],
  ["No violence", "No threats, gore, or encouraging anyone to hurt themselves or others."],
  ["No spam or scams", "No repeated messages, fake giveaways, or shady links."],
] as const;
