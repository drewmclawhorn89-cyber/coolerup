import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { Check, Download, FileAudio, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { hasMusicOfflineAccess, musicOfflinePlan } from "@/lib/subscriptions";
import type { Sound } from "@/lib/sounds";
import {
  canDownloadSong,
  downloadBlockedMessage,
  downloadBlockedReason,
  getSavedSong,
  onOfflineSongsChange,
  removeSongOffline,
  saveSongFileOffline,
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
 * Coolerup-owned audio downloads straight from `audio_url`. YouTube songs can't
 * be fetched (YouTube never hands the audio to the page), so tapping Download
 * opens an explanation sheet instead of jumping straight into the phone's file
 * browser — the user can then attach a file they already have, or back out.
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
  const auth = useAuth();
  const navigate = useNavigate();
  // Offline music is a VIP-only perk. Pro keeps offline videos, but music
  // downloads are locked until VIP (or a lifetime "all access" grant).
  const musicUnlocked = hasMusicOfflineAccess(auth.handle);
  const [downloaded, setDownloaded] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [explain, setExplain] = useState(false);

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
  /** YouTube songs can't be fetched, so the user attaches their own file. */
  const needsFile = blocked === "copyright";
  const fileRef = useRef<HTMLInputElement | null>(null);

  const attachFile = async (file: File | undefined) => {
    if (!file) return;
    if (!musicUnlocked) {
      toast.error("Offline music is a VIP perk.");
      return;
    }
    setBusy(true);
    setPct(0);
    try {
      const size = await saveSongFileOffline(sound, file, (p) => setPct(p));
      setDownloaded(true);
      toast.success(
        `Saved "${file.name}" — plays offline (${Math.max(1, Math.round(size / 1024 / 1024))} MB)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that file.");
    } finally {
      setBusy(false);
      setPct(null);
    }
  };

  const download = async () => {
    if (busy) return;
    if (!musicUnlocked) {
      toast.error(`Offline music is a ${musicOfflinePlan().label} perk.`, {
        action: {
          label: "Upgrade",
          onClick: () => void navigate({ to: "/settings", search: { subscriptions: true } }),
        },
      });
      return;
    }
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

  const onClick = () => {
    if (downloaded) return void remove();
    if (!musicUnlocked) {
      toast.error(`Offline music is a ${musicOfflinePlan().label} perk.`, {
        action: {
          label: "Upgrade",
          onClick: () => void navigate({ to: "/settings", search: { subscriptions: true } }),
        },
      });
      return;
    }
    if (needsFile) {
      // Never yank the user into the file browser without saying why.
      setExplain(true);
      return;
    }
    void download();
  };

  /* Shared picker for every variant. */
  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept="audio/*,.mp3,.m4a,.wav,.ogg,.opus,.flac"
      className="hidden"
      aria-label={`Choose an audio file for ${sound.title}`}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        void attachFile(file);
      }}
    />
  );

  /* Explains the YouTube limitation, then offers the file picker. */
  const sheet =
    explain && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 p-3 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label="YouTube songs can't be downloaded"
            onClick={() => setExplain(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <FileAudio className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm font-bold">YouTube songs can't be downloaded</p>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                YouTube doesn't let apps save its audio. To play{" "}
                <span className="font-semibold text-foreground">{sound.title}</span> offline, add an
                audio file you already have on your phone — Coolerup keeps it in your cache and
                plays it with 0 signal.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExplain(false);
                    fileRef.current?.click();
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white py-2 text-xs font-bold text-black"
                >
                  <FileAudio className="h-3.5 w-3.5" />
                  Add audio file
                </button>
                <button
                  type="button"
                  onClick={() => setExplain(false)}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const downloading = pct !== null;

  const label = downloading ? `Downloading… ${pct ?? 0}%` : downloaded ? "Downloaded" : "Download";

  /* Icon-only: sits on the cover next to the play button. */
  if (variant === "icon") {
    return (
      <>
        {picker}
        {sheet}
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
          title={
            downloaded
              ? "Downloaded — tap to remove"
              : needsFile
                ? "YouTube song — tap to add an audio file"
                : label
          }
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
      </>
    );
  }

  /* Wide: full-width button used inside the players, next to Save. */
  if (variant === "wide") {
    return (
      <>
        {picker}
        {sheet}
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
              : "Download for Offline"}
        </button>
      </>
    );
  }

  /* Pill: compact labelled button for list rows. */
  return (
    <>
      {picker}
      {sheet}
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
    </>
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

/**
 * "Wrong file?" escape hatch for YouTube songs in the Downloaded tab.
 *
 * Because the audio comes from a file the user picked, they can pick the wrong
 * one. This swaps the stored blob for a different file without deleting the
 * entry first, so the song keeps its place in the list.
 */
export function ReplaceAudioButton({
  sound,
  onReplaced,
}: {
  sound: Sound;
  onReplaced?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.ogg,.opus,.flac"
        className="hidden"
        aria-label={`Replace the audio file for ${sound.title}`}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await saveSongFileOffline(sound, file);
            toast.success(`Now playing "${file.name}" offline.`);
            onReplaced?.();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't save that file.");
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        aria-label={`Replace the audio file for ${sound.title}`}
        title="Wrong song? Swap the audio file"
        className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-white/15 px-2 text-[10px] font-bold text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileAudio className="h-3 w-3" />}
        Swap
      </button>
    </>
  );
}
