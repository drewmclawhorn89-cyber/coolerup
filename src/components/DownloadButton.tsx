import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Sound } from "@/lib/sounds";
import {
  canDownloadSong,
  downloadBlockedMessage,
  downloadBlockedReason,
  getSavedSong,
  onOfflineSongsChange,
  removeSongOffline,
  saveSongOffline,
} from "@/lib/offlineSongs";

type Variant = "icon" | "pill" | "wide";

/**
 * Download / remove-download control for a song.
 *
 * Three states, all local to IndexedDB:
 *   idle        → "⬇️ Download"
 *   downloading → "Downloading… 50%" (live progress from the fetch stream)
 *   downloaded  → "✅ Downloaded" (green check) — tapping again removes it
 *
 * YouTube songs are blocked with a "Can't download — copyright" message, since
 * the only legal way to play them is YouTube's own player.
 */
export function DownloadButton({
  sound,
  variant = "pill",
  className = "",
  onRemoved,
}: {
  sound: Sound;
  variant?: Variant;
  className?: string;
  onRemoved?: (() => void) | undefined;
}) {
  const [downloaded, setDownloaded] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const saved = await getSavedSong(sound.id).catch(() => null);
    setDownloaded(Boolean(saved));
  }, [sound.id]);

  useEffect(() => {
    void refresh();
    return onOfflineSongsChange(() => void refresh());
  }, [refresh]);

  const blocked = downloadBlockedReason(sound);
  const allowed = canDownloadSong(sound);

  const download = async () => {
    if (busy) return;
    if (!allowed) {
      toast.error(downloadBlockedMessage(blocked ?? "unavailable"));
      return;
    }
    setBusy(true);
    setPct(0);
    try {
      const size = await saveSongOffline(sound, (p) => setPct(p));
      setDownloaded(true);
      toast.success(`Downloaded — plays offline (${Math.max(1, Math.round(size / 1024))} KB)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download that song.");
    } finally {
      setBusy(false);
      setPct(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await removeSongOffline(sound.id);
      setDownloaded(false);
      toast.success("Removed download.");
      onRemoved?.();
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => void (downloaded ? remove() : download());

  const downloading = pct !== null;

  const label = downloading ? `Downloading… ${pct ?? 0}%` : downloaded ? "Downloaded" : "Download";

  /* Icon-only: sits on the cover next to the play button. */
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClick();
        }}
        aria-label={
          downloaded ? `Remove download of ${sound.title}` : `Download ${sound.title} for offline`
        }
        aria-pressed={downloaded}
        title={downloaded ? "Downloaded — tap to remove" : label}
        className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur transition ${
          downloaded
            ? "bg-emerald-500 text-white"
            : downloading
              ? "bg-black/70 text-white"
              : "bg-black/50 text-white"
        } ${className}`}
      >
        {downloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : downloaded ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </button>
    );
  }

  /* Wide: full-width button used inside the players, next to Save. */
  if (variant === "wide") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-pressed={downloaded}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border py-2 text-xs font-semibold transition disabled:opacity-60 ${
          downloaded
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
            : "border-white/15 text-foreground"
        } ${className}`}
      >
        {downloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : downloaded ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {downloading
          ? `Downloading… ${pct ?? 0}%`
          : downloaded
            ? "Remove Download"
            : blocked === "copyright"
              ? "Can't download"
              : "Download for Offline"}
      </button>
    );
  }

  /* Pill: compact labelled button for list rows. */
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={busy}
      aria-pressed={downloaded}
      aria-label={
        downloaded ? `Remove download of ${sound.title}` : `Download ${sound.title} for offline`
      }
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold transition disabled:opacity-60 ${
        downloaded
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
          : "border-white/15 text-muted-foreground"
      } ${className}`}
    >
      {downloading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : downloaded ? (
        <Check className="h-3 w-3" />
      ) : (
        <Download className="h-3 w-3" />
      )}
      <span className="tabular-nums">
        {downloading ? `${pct ?? 0}%` : downloaded ? "Downloaded" : "Download"}
      </span>
    </button>
  );
}

/** Small "downloaded" tick shown on a cover when a song is stored offline. */
export function OfflineBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Downloaded — plays offline"
      aria-label="Downloaded"
      className={`flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow ${className}`}
    >
      <Download className="h-2.5 w-2.5" />
    </span>
  );
}

/** Trash control used in the Downloaded tab. */
export function RemoveDownloadButton({
  sound,
  onRemoved,
}: {
  sound: Sound;
  onRemoved?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await removeSongOffline(sound.id);
          toast.success("Removed download.");
          onRemoved?.();
        } finally {
          setBusy(false);
        }
      }}
      aria-label={`Remove download of ${sound.title}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-red-400 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
