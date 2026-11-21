import { Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { offlinePlan } from "@/lib/subscriptions";

/**
 * Shown whenever a free account tries to turn on Offline Mode or download a
 * video. Nothing is downloaded until the plan is paid and active.
 */
export function OfflinePaywallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const plan = offlinePlan();

  const subscribe = () => {
    onClose();
    window.location.href = "/settings?subscriptions=1";
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="border-white/15 bg-black text-white sm:max-w-sm">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <DialogTitle className="mt-3 text-center text-lg font-bold text-white">
            Offline Mode is for Paid Subscribers
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-white/70">
            Offline Mode is included with every paid plan — Plus, Pro and VIP. Subscribe to download
            videos and watch them without a connection. Nothing is downloaded until your plan is
            active.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2 flex-col gap-2 sm:flex-col">
          <button
            type="button"
            onClick={subscribe}
            className="w-full rounded-md bg-white px-4 py-2 font-semibold text-black transition hover:bg-white/90"
          >
            Subscribe · from ${plan.price.toFixed(2)}/mo
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md border border-white/20 px-4 py-2 font-medium text-white transition hover:bg-white/10"
          >
            Not now
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
