import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const REASONS = [
  ["spam", "Spam"],
  ["nudity", "Nudity / Sexual"],
  ["harassment", "Harassment / Bullying"],
  ["hate", "Hate speech"],
  ["violence", "Violence"],
  ["scam", "Scam"],
  ["minor", "Involves a minor"],
  ["other", "Other"],
] as const;

export function ReportDialog({ username, videoId, onClose }: { username: string; videoId?: string; onClose: () => void }) {
  const auth = useAuth();
  const [reason, setReason] = useState<(typeof REASONS)[number][0] | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!auth.user || !auth.handle) return auth.signIn();
    if (!reason) return;
    setBusy(true);
    const { error } = await supabase.from("reports").insert({
      reporter_id: auth.user.id,
      reporter_username: auth.handle,
      reported_username: username,
      reported_video_id: videoId ?? null,
      reason,
      details: details.trim().slice(0, 1000) || null,
    });
    setBusy(false);
    if (error) return toast.error("Couldn't send report");
    toast.success("Report sent, we review in 24h");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-overlay p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-t-3xl border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg">Report @{username}</h2>
          <button onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        {!auth.user ? (
          <Button onClick={auth.signIn} className="w-full rounded-full">Sign in with Google to report</Button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {REASONS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setReason(id)}
                  className={`rounded-full border px-3 py-2 text-sm font-bold transition ${reason === id ? "border-primary bg-primary/10 text-primary" : "hover:bg-secondary"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              placeholder="Anything else? (optional)"
              className="mt-3 h-20 w-full resize-none rounded-2xl bg-secondary p-3 text-sm outline-none"
            />
            <Button disabled={!reason || busy} onClick={submit} className="mt-3 w-full rounded-full">Send report</Button>
          </>
        )}
      </div>
    </div>
  );
}
