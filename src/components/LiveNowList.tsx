import { Eye, Radio } from "lucide-react";
import type { LiveHost } from "@/lib/liveDirectory";

/** Initials for the avatar bubble, so cards look like people not placeholders. */
function initials(name: string) {
  const clean = name.replace(/^@/, "").trim();
  return (clean.slice(0, 2) || "??").toUpperCase();
}

/** One broadcaster in the "Live now" list. */
export function LiveCard({ host, onWatch }: { host: LiveHost; onWatch: (host: LiveHost) => void }) {
  return (
    <button
      type="button"
      onClick={() => onWatch(host)}
      className="group flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-[#fe2c55]/60 hover:bg-white/10 active:scale-[0.99]"
    >
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#fe2c55] to-[#7a1bff] text-sm font-black text-white">
        {initials(host.username)}
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-[#fe2c55] px-1.5 py-px text-[8px] font-black uppercase tracking-wider text-white ring-2 ring-black">
          Live
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">@{host.username}</span>
        <span className="block truncate text-xs text-white/50">{host.title}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80 group-hover:bg-[#fe2c55] group-hover:text-white">
        <Eye className="h-3.5 w-3.5" /> Watch
      </span>
    </button>
  );
}

type Props = {
  hosts: LiveHost[];
  onWatch: (host: LiveHost) => void;
  onGoLive: () => void;
  /** Extra classes for the scroll container. */
  className?: string;
};

/**
 * The LIVE tab body: everyone currently broadcasting, plus a Go LIVE action.
 * Used by both the feed's top tabs and the `/live` route so the two never drift.
 */
export function LiveNowList({ hosts, onWatch, onGoLive, className = "" }: Props) {
  return (
    <div className={`mx-auto w-full max-w-md px-5 pb-28 pt-6 ${className}`} data-testid="live-directory">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">
          <span className="relative flex h-2 w-2">
            {hosts.length > 0 && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#fe2c55] opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                hosts.length > 0 ? "bg-[#fe2c55]" : "bg-white/30"
              }`}
            />
          </span>
          {hosts.length > 0 ? `${hosts.length} live now` : "Live now"}
        </div>
        <button
          type="button"
          onClick={onGoLive}
          className="flex items-center gap-1.5 rounded-full bg-[#fe2c55] px-3.5 py-1.5 text-xs font-extrabold text-white transition active:scale-[0.98]"
        >
          <Radio className="h-3.5 w-3.5" /> Go LIVE
        </button>
      </div>

      {hosts.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          No one is live right now. Be the first — tap Go LIVE and your stream shows up here.
        </p>
      ) : (
        <div className="space-y-2">
          {hosts.map((host) => (
            <LiveCard key={host.userId} host={host} onWatch={onWatch} />
          ))}
        </div>
      )}
    </div>
  );
}
