import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addYouTubeVideo } from "@/lib/youtube.functions";
import { extractYouTubeId } from "@/lib/youtube";
import { PaidVideoFields, paidSelectionInvalid } from "@/components/PaidVideoFields";
import type { FullVideo } from "@/lib/fullVideos";

export function AddYouTubeModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (video: FullVideo) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const add = useServerFn(addYouTubeVideo);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] rounded-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Paste YouTube link</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            if (!extractYouTubeId(url)) {
              setError("Paste a valid YouTube video link.");
              return;
            }
            if (paidSelectionInvalid(isPaid, priceCents)) {
              setError("Pick a price between $0.50 and $1,000 for your paid video.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              const video = await add({
                data: { url, isPaid, priceCents: isPaid ? priceCents : null },
              });
              onAdded(video);
              setUrl("");
              setIsPaid(false);
              setPriceCents(null);
              onClose();
              toast.success("YouTube video added.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not add this video.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            aria-label="YouTube link"
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError("");
            }}
            disabled={busy}
            autoFocus
          />
          <PaidVideoFields
            enabled={isPaid}
            onEnabledChange={setIsPaid}
            priceCents={priceCents}
            onPriceCentsChange={setPriceCents}
          />

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !url.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} {busy ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
