import { BadgeCheck } from "lucide-react";

/**
 * The Coolerup Safety Bot.
 *
 * The bot is a REAL account: it has a row in `auth.users`, a row in
 * `public.profiles` (handle `coolerup_safety`), a `moderator` role, and a real
 * avatar. Because the handle is taken in the database, nobody can register it
 * and impersonate the bot.
 *
 * These constants mirror the database row so the badge, name and bio are
 * identical everywhere, even before the profile query resolves.
 */
export const SAFETY_BOT_HANDLE = "coolerup_safety";
export const SAFETY_BOT_NAME = "Coolerup Safety Bot";
export const SAFETY_BOT_AVATAR = "/safety-bot.png";
export const SAFETY_BOT_EMAIL = "safety-bot@coolerup.app";
/** Matches public.safety_bot_uid() in migration 0029. */
export const SAFETY_BOT_UID = "00000000-0000-4000-8000-0000000005af";
export const SAFETY_BOT_BIO =
  "I watch new videos, comments, messages, bios and profile pictures 24/7. I remove content that breaks the rules and apply the 3-strike ladder. I never flag you for reposting someone else's video.";

/** True for the bot's handle or its real account id. */
export function isSafetyBot(username?: string | null, userId?: string | null): boolean {
  if (userId && userId === SAFETY_BOT_UID) return true;
  return (username ?? "").replace(/^@+/, "").trim().toLowerCase() === SAFETY_BOT_HANDLE;
}

/** Green-check badge shown next to the bot's name. */
export function SafetyBotBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400"
      title="Official Coolerup Safety Bot"
    >
      <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
      {!compact && <span>Safety Bot</span>}
    </span>
  );
}
