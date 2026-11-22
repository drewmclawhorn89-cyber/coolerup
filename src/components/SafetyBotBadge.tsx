import { BadgeCheck } from "lucide-react";

/**
 * The Coolerup Safety Bot.
 *
 * The bot has no auth account: it is a system actor. Its profile is rendered
 * from this module so the badge, name and bio are identical everywhere and
 * nobody can register the handle and impersonate it.
 */
export const SAFETY_BOT_HANDLE = "coolerup_safety";
export const SAFETY_BOT_NAME = "Coolerup Safety Bot";
export const SAFETY_BOT_AVATAR = "/safety-bot.png";
export const SAFETY_BOT_BIO =
  "I watch new videos, comments, messages, bios and profile pictures 24/7. I remove content that breaks the rules and apply the 3-strike ladder. I never flag you for reposting someone else's video.";

export function isSafetyBot(username?: string | null): boolean {
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
