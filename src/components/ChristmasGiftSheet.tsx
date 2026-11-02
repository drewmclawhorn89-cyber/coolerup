import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { CHRISTMAS_GIFTS, getChristmasGift } from "@/lib/christmas";
import { notifyUser, profileIdForHandle } from "@/lib/notify";

/**
 * "Send a Christmas gift" sheet, opened from the 🎁 button next to Share.
 *
 * Gifts are virtual (free, no payment): sending one drops a notification in the
 * creator's inbox that reads "Sent you a Christmas gift!".
 */
export function ChristmasGiftSheet({
  open,
  onOpenChange,
  videoId,
  recipientHandle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId?: string | null;
  recipientHandle: string;
}) {
  const auth = useAuth();
  const [giftId, setGiftId] = useState(CHRISTMAS_GIFTS[0]!.id);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const gift = getChristmasGift(giftId) ?? CHRISTMAS_GIFTS[0]!;

  const send = async () => {
    if (!auth.user) {
      auth.signIn();
      return;
    }
    if (sending) return;
    if (recipientHandle === auth.handle) {
      toast.error("You can't gift your own video");
      return;
    }
    setSending(true);
    try {
      const targetUserId = await profileIdForHandle(recipientHandle);
      if (!targetUserId) {
        toast.error("Couldn't find that creator");
        return;
      }
      const note = message.trim().slice(0, 120);
      await notifyUser({
        targetUserId,
        actorUserId: auth.user.id,
        type: "gift",
        title: "Christmas gift 🎁",
        text: `Sent you a Christmas gift! ${gift.emoji} ${gift.name}${note ? ` — "${note}"` : ""}`,
        videoId: videoId ?? null,
        url: `/u/${recipientHandle}`,
      });
      toast.success(`🎁 Sent a ${gift.name.toLowerCase()} to @${recipientHandle}!`);
      setMessage("");
      onOpenChange(false);
    } catch {
      toast.error("Couldn't send that gift. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span aria-hidden>🎁</span> Send a Christmas gift
          </DialogTitle>
          <DialogDescription>
            Send @{recipientHandle} a virtual gift. It's free — they'll get a notification saying
            you sent them one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Choose a gift">
          {CHRISTMAS_GIFTS.map((g) => {
            const active = g.id === giftId;
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setGiftId(g.id)}
                className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 transition ${
                  active
                    ? "border-[#2ecc55] bg-[#2ecc55]/10"
                    : "border-border hover:border-foreground/30 hover:bg-accent"
                }`}
              >
                <span className="text-2xl leading-none" aria-hidden>
                  {g.emoji}
                </span>
                <span className="text-[10px] font-semibold leading-tight">{g.name}</span>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">{gift.blurb}</p>

        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Add a note (optional)
          </span>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={120}
            placeholder="Merry Christmas!"
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <Button onClick={() => void send()} disabled={sending} className="w-full gap-2">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? "Sending…" : `Send ${gift.emoji} ${gift.name}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
