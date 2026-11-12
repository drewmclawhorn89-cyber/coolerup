import { Check, Loader2, UserCheck, UserPlus, Users, UserX, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MAX_GUESTS,
  activeGuests,
  guestName,
  joinBannerText,
  requestName,
  stageUsage,
  type JoinRequest,
  type LiveGuest,
} from "@/lib/liveJoin";

function initials(name: string): string {
  return name.replace(/^@/, "").slice(0, 2).toUpperCase() || "?";
}

/**
 * The floating banner the host sees the moment someone asks to join.
 *
 * Shows the newest pending request with Accept / Reject, and a "+N more" hint
 * that opens the full sheet.
 */
export function LiveJoinBanner({
  requests,
  busy,
  onAccept,
  onReject,
  onOpenAll,
}: {
  requests: JoinRequest[];
  busy?: boolean;
  onAccept: (request: JoinRequest) => void;
  onReject: (request: JoinRequest) => void;
  onOpenAll: () => void;
}) {
  const first = requests[0];
  if (!first) return null;
  const extra = requests.length - 1;

  return (
    <div className="pointer-events-auto mx-3 flex items-center gap-2 rounded-2xl border border-white/15 bg-black/80 p-2 pl-2.5 shadow-lg backdrop-blur-md">
      <Avatar className="h-8 w-8 shrink-0">
        {first.profile?.avatar_url ? <AvatarImage src={first.profile.avatar_url} alt="" /> : null}
        <AvatarFallback className="bg-[#fe2c55]/25 text-[10px] font-bold text-white">
          {initials(requestName(first))}
        </AvatarFallback>
      </Avatar>
      <button
        type="button"
        onClick={onOpenAll}
        className="min-w-0 flex-1 text-left"
        aria-label="View all join requests"
      >
        <p className="truncate text-xs font-bold text-white">
          {joinBannerText(first)}
          {extra > 0 && <span className="text-white/60"> +{extra} more</span>}
        </p>
        <p className="text-[10px] text-white/50">Tap to review all requests</p>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onAccept(first)}
        aria-label={`Accept ${requestName(first)}`}
        className="flex h-8 items-center gap-1 rounded-full bg-emerald-500 px-2.5 text-[11px] font-extrabold text-white transition active:scale-95 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Accept
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onReject(first)}
        aria-label={`Reject ${requestName(first)}`}
        className="flex h-8 items-center gap-1 rounded-full bg-white/15 px-2.5 text-[11px] font-extrabold text-white/80 transition active:scale-95 disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
        Reject
      </button>
    </div>
  );
}

/**
 * Full requests + on-stage sheet, opened from the 👥 icon in the host bar.
 *
 * Pending requests get Accept / Reject; people already on stage get Remove.
 * The header shows "2 of 4 guest spots used".
 */
export function LiveJoinRequestSheet({
  open,
  onOpenChange,
  requests,
  guests,
  busy,
  onAccept,
  onReject,
  onRemoveGuest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: JoinRequest[];
  guests: LiveGuest[];
  busy?: boolean;
  onAccept: (request: JoinRequest) => void;
  onReject: (request: JoinRequest) => void;
  onRemoveGuest: (guest: LiveGuest) => void;
}) {
  const onStage = activeGuests(guests);
  const full = onStage.length >= MAX_GUESTS;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="h-[70dvh] max-h-[38rem] border-t border-white/10 bg-black/95 text-white backdrop-blur-xl focus:outline-none"
        aria-describedby={undefined}
      >
        <DrawerTitle className="sr-only">Join requests</DrawerTitle>
        <DrawerDescription className="sr-only">
          Accept or reject viewers asking to join your LIVE, and manage who is on stage.
        </DrawerDescription>

        <div className="flex h-full flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
          <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/25" />

          <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-base font-extrabold">
                <Users className="h-4 w-4 text-[#fe2c55]" />
                Guests
              </p>
              <p className="mt-0.5 text-[11px] text-white/50">{stageUsage(guests)}</p>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-extrabold text-white/70">
              {onStage.length}/{MAX_GUESTS}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-2">
            <section className="space-y-2">
              <h3 className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-white/40">
                Requests ({requests.length})
              </h3>
              {requests.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-white/40">
                  No one is waiting to join. Requests show up here the moment a viewer taps “Request
                  to join LIVE”.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {requests.map((request) => (
                    <li
                      key={request.id}
                      className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2"
                    >
                      <Avatar className="h-9 w-9">
                        {request.profile?.avatar_url ? (
                          <AvatarImage src={request.profile.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className="bg-[#fe2c55]/25 text-[10px] font-bold text-white">
                          {initials(requestName(request))}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        @{requestName(request)}
                      </span>
                      <button
                        type="button"
                        disabled={busy || full}
                        onClick={() => onAccept(request)}
                        className="flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-extrabold text-white transition active:scale-95 disabled:opacity-40"
                      >
                        <UserCheck className="h-3.5 w-3.5" /> Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onReject(request)}
                        className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-extrabold text-white/70 transition active:scale-95 disabled:opacity-40"
                      >
                        <UserX className="h-3.5 w-3.5" /> Reject
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {full && requests.length > 0 && (
                <p className="px-1 text-[11px] font-semibold text-amber-300">
                  All {MAX_GUESTS} guest spots are taken. Remove a guest to accept someone new.
                </p>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-white/40">
                On stage ({onStage.length})
              </h3>
              {onStage.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-white/40">
                  It's just you right now. Accept a request to bring someone on screen.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {onStage.map((guest) => (
                    <li
                      key={guest.id}
                      className="flex items-center gap-2.5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-2"
                    >
                      <Avatar className="h-9 w-9">
                        {guest.profile?.avatar_url ? (
                          <AvatarImage src={guest.profile.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className="bg-emerald-500/20 text-[10px] font-bold text-emerald-200">
                          {initials(guestName(guest))}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm font-semibold text-emerald-200">
                        <UserPlus className="h-3.5 w-3.5 shrink-0" />@{guestName(guest)}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRemoveGuest(guest)}
                        className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-extrabold text-white/70 transition active:scale-95 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close guests"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70"
        >
          <X className="h-4 w-4" />
        </button>
      </DrawerContent>
    </Drawer>
  );
}
