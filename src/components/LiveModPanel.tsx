import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  MessageSquareOff,
  MessageSquare,
  Search,
  Shield,
  ShieldCheck,
  UserMinus,
  UserPlus,
  VolumeX,
  X,
} from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { MAX_MODS, muteLabel, searchFollowers, type LiveMod, type LiveMute } from "@/lib/liveMods";

type FollowerRow = {
  id: string;
  handle: string;
  username: string | null;
  avatar_url: string | null;
};

function initials(name: string): string {
  return name.replace(/^@/, "").slice(0, 2).toUpperCase() || "?";
}

function nameOf(row: { username?: string | null; handle?: string | null }): string {
  return row.username || row.handle || "user";
}

/**
 * Host-only "Moderators" sheet.
 *
 * Settings gear → Moderators → the current mod list, a search over the host's
 * followers to add new ones, and the list of muted viewers. Everything is
 * capped at {@link MAX_MODS} exactly like TikTok.
 *
 * Purely presentational: the parent owns the RPC calls so it can also drop a
 * system message into chat when someone is promoted or muted.
 */
export function LiveModPanel({
  open,
  onOpenChange,
  hostHandle,
  mods,
  mutes,
  commentsOff,
  loading,
  busy,
  onAdd,
  onRemove,
  onUnmute,
  onToggleComments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostHandle: string;
  mods: LiveMod[];
  mutes: LiveMute[];
  commentsOff: boolean;
  loading?: boolean;
  busy?: boolean;
  onAdd: (user: FollowerRow) => void;
  onRemove: (mod: LiveMod) => void;
  onUnmute: (mute: LiveMute) => void;
  onToggleComments: (off: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FollowerRow[]>([]);
  const [searching, setSearching] = useState(false);

  // Reset the search every time the sheet opens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Debounced follower search.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchFollowers(hostHandle, term).then((rows) => {
        if (cancelled) return;
        setSearching(false);
        setResults(rows);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, hostHandle]);

  const modIds = useMemo(() => new Set(mods.map((mod) => mod.user_id)), [mods]);
  const atLimit = mods.length >= MAX_MODS;
  const now = Date.now();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="h-[78dvh] max-h-[42rem] border-t border-white/10 bg-black/95 text-white backdrop-blur-xl focus:outline-none"
        aria-describedby={undefined}
      >
        <DrawerTitle className="sr-only">Moderators</DrawerTitle>
        <DrawerDescription className="sr-only">
          Add and remove moderators, review muted viewers and switch comments off.
        </DrawerDescription>

        <div className="flex h-full flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
          <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/25" />

          <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-base font-extrabold">
                <ShieldCheck className="h-4 w-4 text-sky-400" />
                Moderators
              </p>
              <p className="mt-0.5 text-[11px] text-white/50">
                Mods can mute, block, pin and switch comments off. Only you can add or remove them.
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                atLimit ? "bg-amber-400/20 text-amber-300" : "bg-white/10 text-white/70"
              }`}
              data-testid="mod-counter"
            >
              {mods.length}/{MAX_MODS}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-2">
            {/* Add moderator */}
            <section className="space-y-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={atLimit ? "Mod limit reached" : "Search followers to add…"}
                  disabled={atLimit}
                  className="w-full rounded-full border border-white/10 bg-white/5 py-2.5 pl-9 pr-9 text-sm text-white placeholder:text-white/40 focus:border-sky-400/60 focus:outline-none disabled:opacity-50"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </label>

              {atLimit && (
                <p className="text-[11px] font-semibold text-amber-300">
                  You've reached the {MAX_MODS} moderator limit. Remove one to add another.
                </p>
              )}

              {searching && (
                <p className="flex items-center gap-2 px-1 text-xs text-white/50">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching followers…
                </p>
              )}

              {!searching && query.trim() && results.length === 0 && (
                <p className="px-1 text-xs text-white/40">No followers match “{query.trim()}”.</p>
              )}

              {results.length > 0 && (
                <ul className="space-y-1.5">
                  {results.map((row) => {
                    const already = modIds.has(row.id);
                    return (
                      <li
                        key={row.id}
                        className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2"
                      >
                        <Avatar className="h-8 w-8">
                          {row.avatar_url ? <AvatarImage src={row.avatar_url} alt="" /> : null}
                          <AvatarFallback className="bg-white/10 text-[10px] font-bold">
                            {initials(nameOf(row))}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          @{row.handle}
                        </span>
                        <button
                          type="button"
                          disabled={already || atLimit || busy}
                          onClick={() => onAdd(row)}
                          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-extrabold transition active:scale-95 disabled:opacity-40 ${
                            already ? "bg-white/10 text-white/60" : "bg-sky-500 text-white"
                          }`}
                        >
                          {already ? (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5" /> Mod
                            </>
                          ) : (
                            <>
                              <UserPlus className="h-3.5 w-3.5" /> Add
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Current mods */}
            <section className="space-y-2">
              <h3 className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-white/40">
                In this LIVE ({mods.length})
              </h3>
              {loading && mods.length === 0 ? (
                <p className="flex items-center gap-2 px-1 text-xs text-white/50">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading moderators…
                </p>
              ) : mods.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
                  No moderators yet. Search your followers above to promote one.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {mods.map((mod) => (
                    <li
                      key={mod.id}
                      className="flex items-center gap-2.5 rounded-2xl border border-sky-400/20 bg-sky-400/5 px-2.5 py-2"
                    >
                      <Avatar className="h-8 w-8">
                        {mod.profile?.avatar_url ? (
                          <AvatarImage src={mod.profile.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className="bg-sky-500/20 text-[10px] font-bold text-sky-200">
                          {initials(nameOf(mod.profile ?? {}))}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm font-semibold">
                        <Shield className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                        <span className="truncate text-sky-300">@{nameOf(mod.profile ?? {})}</span>
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemove(mod)}
                        aria-label={`Remove ${nameOf(mod.profile ?? {})} as moderator`}
                        className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-extrabold text-white/70 transition active:scale-95 disabled:opacity-40"
                      >
                        <UserMinus className="h-3.5 w-3.5" /> Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Muted viewers */}
            <section className="space-y-2">
              <h3 className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-white/40">
                Muted ({mutes.length})
              </h3>
              {mutes.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-white/40">
                  Nobody is muted right now.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {mutes.map((mute) => (
                    <li
                      key={mute.id}
                      className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2"
                    >
                      <VolumeX className="h-4 w-4 shrink-0 text-white/50" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        @{nameOf(mute.profile ?? {})}
                      </span>
                      <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/60">
                        {muteLabel(mute, now)}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onUnmute(mute)}
                        className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-extrabold text-white/70 transition active:scale-95 disabled:opacity-40"
                      >
                        Unmute
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Comments */}
            <section className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {commentsOff ? (
                  <MessageSquareOff className="h-4 w-4 shrink-0 text-rose-400" />
                ) : (
                  <MessageSquare className="h-4 w-4 shrink-0 text-white/60" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold">Comments</p>
                  <p className="text-[11px] text-white/50">
                    {commentsOff ? "Comments are off for everyone" : "Viewers can chat"}
                  </p>
                </div>
              </div>
              <Switch
                checked={!commentsOff}
                onCheckedChange={(next) => onToggleComments(!next)}
                aria-label="Toggle comments"
              />
            </section>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close moderators"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70"
        >
          <X className="h-4 w-4" />
        </button>
      </DrawerContent>
    </Drawer>
  );
}
