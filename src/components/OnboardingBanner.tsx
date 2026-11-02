import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ONBOARDING_REQUIRED_EVENT, requireOnboarding } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Yellow "Complete profile — required" banner, shown above the feed for
 * signed-in accounts that still need a username/birthday. Old accounts keep
 * watching, scrolling and using Lite mode — this banner never blocks the app.
 */
export function OnboardingBanner() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (!auth.user || !auth.onboarding.ready || !auth.onboarding.needsOnboarding) return null;

  return (
    <button
      type="button"
      onClick={() => void navigate({ to: "/onboarding" })}
      className="flex w-full shrink-0 items-center gap-2 bg-yellow-400 px-4 py-1.5 text-left text-xs font-bold text-yellow-950 transition hover:bg-yellow-300 md:px-10"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Complete profile — required. Add username and birthday to keep posting.
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

/**
 * Modal shown when an incomplete account tries to post, record, upload or like.
 * Mounted once in the root route so any screen can trigger it.
 */
export function OnboardingRequiredDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(ONBOARDING_REQUIRED_EVENT, show);
    return () => window.removeEventListener(ONBOARDING_REQUIRED_EVENT, show);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Complete your profile first
          </DialogTitle>
          <DialogDescription>
            Add your username and birthday to keep posting, uploading and liking. Your existing
            videos and likes stay exactly where they are.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button
            className="w-full rounded-full"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/onboarding" });
            }}
          >
            Complete profile
          </Button>
          <Button variant="ghost" className="w-full rounded-full" onClick={() => setOpen(false)}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Wrap any posting/liking action. Signed-in but incomplete accounts get the
 * modal instead of the action; everyone else runs the action unchanged.
 */
export function useOnboardingGuard() {
  const auth = useAuth();
  return useCallback(
    (action: () => void) => {
      if (auth.user && auth.onboarding.needsOnboarding) {
        requireOnboarding();
        return;
      }
      action();
    },
    [auth.user, auth.onboarding.needsOnboarding],
  );
}
