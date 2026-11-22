import { useEffect, useRef, useState } from "react";
import { Loader2, Music, Scissors, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PaidVideoFields, paidSelectionInvalid } from "@/components/PaidVideoFields";
import { SoundPickerDialog } from "@/components/SoundPickerDialog";
import { fetchTracks, type Track } from "@/components/MusicPlayer";
import { getSound, type Sound } from "@/lib/sounds";
import {
  isImageUrl,
  parseCaption,
  rebuildCaption,
  replaceVideoFile,
  resolveVideoUrl,
  songStreamUrl,
  updateVideoDetails,
  type Song,
  type Video,
} from "@/lib/loop";
import { MIN_TRIM_SECONDS, trimVideoFile, type TrimProgress } from "@/lib/videoEdit";

type Props = {
  video: Video;
  open: boolean;
  onClose: () => void;
  /** Fired with the values the card should patch in place after a save. */
  onSaved: (next: {
    caption: string;
    username?: string;
    sound_id?: string | null;
    is_paid?: boolean;
    price_cents?: number | null;
    video_url?: string;
  }) => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Owner-only editor for a published Short.
 *
 * Deliberately mirrors the post form field-for-field — username, caption,
 * sound, paid settings — plus the one thing you can only do after posting:
 * trim the clip. Trimming re-encodes in the browser, uploads the result and
 * repoints the same row, so likes/comments/shares are untouched. Images and
 * TikTok imports have no local file to cut, so they get everything but trim.
 */
export function EditVideoDialog({ video, open, onClose, onSaved }: Props) {
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isImage =
    isImageUrl(video.video_url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(video.video_url);
  const isTikTok = Boolean(video.is_tiktok && video.tiktok_id);
  const canTrim = !isImage && !isTikTok;

  const [username, setUsername] = useState("");
  const [caption, setCaption] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);

  // Sound (video) / song (photo) — the same two paths the post form offers.
  const [chosenSound, setChosenSound] = useState<Sound | null>(null);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [song, setSong] = useState<Song | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);

  // Paid settings, seeded from the row so an existing paid video opens as ON.
  const [isPaid, setIsPaid] = useState(false);
  const [priceCents, setPriceCents] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<TrimProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever a different video (or a fresh open) comes in.
  useEffect(() => {
    if (!open) return;
    const parsed = parseCaption(video.caption);
    setUsername(video.username ?? "");
    setCaption(parsed.text);
    setSong(parsed.song);
    setDuration(0);
    setStart(0);
    setEnd(0);
    setIsPaid(Boolean(video.is_paid));
    setPriceCents(video.price_cents ?? null);
    setQ("");
    setResults([]);
    setSaving(false);
    setProgress(null);
    setError(null);
  }, [open, video.id, video.caption, video.username, video.is_paid, video.price_cents]);

  // Resolve the current sound so the picker shows "Original sound" vs a title.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setChosenSound(null);
    if (!video.sound_id) return;
    void getSound(video.sound_id).then((s) => {
      if (alive) setChosenSound(s);
    });
    return () => {
      alive = false;
    };
  }, [open, video.sound_id]);

  // Resolve the playable URL for the preview.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPreviewSrc("");
    void resolveVideoUrl(video.video_url).then((url) => {
      if (alive) setPreviewSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [open, video.video_url]);

  // Song search for photos, exactly like the post form's picker.
  const findSongs = async () => {
    setSearching(true);
    try {
      setResults((await fetchTracks(q)).slice(0, 10));
    } catch {
      toast.error("Couldn't load songs");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (isImage && open && results.length === 0) void findSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage, open]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const chooseSong = (t: Track) => {
    audioRef.current?.pause();
    if (song?.id === t.id) {
      setSong(null);
      return;
    }
    setSong({ id: t.id, title: t.title, artist: t.artist });
    const a = new Audio(songStreamUrl(t.id));
    audioRef.current = a;
    void a.play().catch(() => {});
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const trimStart = canTrim ? start : 0;
  const trimEnd = canTrim ? end : duration;
  const trimmed = canTrim && duration > 0 && (trimStart > 0.05 || trimEnd < duration - 0.05);
  const trimmedLength = Math.max(0, trimEnd - trimStart);

  function seekTo(seconds: number) {
    const el = previewRef.current;
    if (!el) return;
    try {
      el.currentTime = seconds;
    } catch {
      /* metadata not ready yet */
    }
  }

  async function save() {
    if (saving) return;
    setError(null);

    const cleanUsername = username.trim().replace(/^@/, "");
    if (cleanUsername.length < 1) {
      setError("Add a username.");
      return;
    }
    if (!isImage && isPaid && paidSelectionInvalid(true, priceCents)) {
      setError("Pick a price between $0.50 and $1,000 for your paid video.");
      return;
    }
    if (trimmed && trimmedLength < MIN_TRIM_SECONDS) {
      setError(`Keep at least ${MIN_TRIM_SECONDS} second of video.`);
      return;
    }

    // Photos carry their song in the caption tag; videos use the sound_id column.
    const nextCaption = isImage
      ? rebuildCaption(caption, video.caption, { song })
      : rebuildCaption(caption, video.caption, { dropSong: true });
    const nextSoundId = isImage ? null : (chosenSound?.id ?? null);
    const paidPatch = isImage
      ? { is_paid: false, price_cents: null }
      : { is_paid: isPaid, price_cents: isPaid ? priceCents : null };

    setSaving(true);
    try {
      if (trimmed) {
        if (!previewSrc) throw new Error("Couldn't load the video to trim it.");
        setProgress({ percent: 0, stage: "Preparing" });
        const resp = await fetch(previewSrc);
        if (!resp.ok) throw new Error("Couldn't download the video to trim it.");
        const blob = await resp.blob();
        const file = new File([blob], `${video.id}.mp4`, { type: blob.type || "video/mp4" });
        const cut = await trimVideoFile(file, trimStart, trimEnd, setProgress);
        const next = await replaceVideoFile(video, cut, {
          caption: nextCaption,
          username: cleanUsername,
          sound_id: nextSoundId,
          ...paidPatch,
        });
        onSaved({
          caption: nextCaption,
          username: cleanUsername,
          sound_id: nextSoundId,
          ...paidPatch,
          video_url: next.video_url,
        });
        toast.success("Video updated");
      } else {
        await updateVideoDetails(video.id, {
          caption: nextCaption,
          username: cleanUsername,
          sound_id: nextSoundId,
          ...paidPatch,
        });
        onSaved({
          caption: nextCaption,
          username: cleanUsername,
          sound_id: nextSoundId,
          ...paidPatch,
        });
        toast.success("Video updated");
      }
      onClose();
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save your changes. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-black/60"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit video"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-background text-foreground shadow-2xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-bold">Edit video</h2>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            aria-label="Close"
            className="rounded-full p-1.5 hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            {/* Preview — same 9:16 frame the post form shows. */}
            <div className="shrink-0 overflow-hidden rounded-xl bg-black sm:w-48">
              {isImage ? (
                previewSrc ? (
                  <img
                    src={previewSrc}
                    alt=""
                    className="mx-auto max-h-[32vh] w-full object-contain sm:aspect-[9/16] sm:max-h-none sm:object-cover"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-zinc-400">
                    Loading preview…
                  </div>
                )
              ) : isTikTok ? (
                <div className="flex h-40 items-center justify-center px-4 text-center text-xs text-zinc-400 sm:h-full">
                  TikTok imports can't be trimmed here — every other setting still works.
                </div>
              ) : (
                <video
                  ref={previewRef}
                  src={previewSrc || undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto max-h-[32vh] w-full object-contain sm:aspect-[9/16] sm:max-h-none sm:object-cover"
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    if (Number.isFinite(d) && d > 0) {
                      setDuration(d);
                      setStart(0);
                      setEnd(d);
                    }
                  }}
                />
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <label className="text-sm font-semibold">
                Username
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={40}
                  disabled={saving}
                  className="mt-1 w-full rounded-lg bg-secondary px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

              <label className="text-sm font-semibold">
                Caption
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="Say something real… #hashtags"
                  disabled={saving}
                  className="mt-1 w-full resize-none rounded-lg bg-secondary px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="mt-1 block text-right text-[11px] font-normal text-muted-foreground">
                  {caption.length}/500
                </span>
              </label>

              {/* VIDEO: sound picker, identical to the post form's chip. */}
              {!isImage && (
                <button
                  type="button"
                  onClick={() => setSoundPickerOpen(true)}
                  disabled={saving}
                  className="flex max-w-full items-center gap-2 self-start rounded-full bg-secondary px-3 py-2 text-left text-xs font-semibold transition hover:bg-accent"
                >
                  <Music className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 truncate">
                    {chosenSound ? chosenSound.title : "Original sound"}
                  </span>
                  <span className="shrink-0 text-muted-foreground">· Change</span>
                </button>
              )}

              {/* PHOTO: song search, identical to the post form's list. */}
              {isImage && (
                <div className="min-w-0 text-sm">
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    <Music className="h-4 w-4 text-primary" /> Add a song
                    {song && (
                      <span className="min-w-0 truncate font-normal text-muted-foreground">
                        · {song.title}
                      </span>
                    )}
                  </div>
                  <div className="mb-2 flex items-center gap-2 rounded-full bg-secondary px-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void findSongs();
                        }
                      }}
                      placeholder="Search songs"
                      disabled={saving}
                      className="h-9 w-full bg-transparent outline-none"
                    />
                  </div>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {searching ? (
                      <p className="py-2 text-muted-foreground">Loading…</p>
                    ) : (
                      results.map((t) => (
                        <button
                          type="button"
                          key={t.id}
                          onClick={() => chooseSong(t)}
                          disabled={saving}
                          className={`flex w-full items-center gap-2 rounded-lg p-2 text-left ${
                            song?.id === t.id ? "bg-primary/20" : "hover:bg-secondary"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{t.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {t.artist}
                            </span>
                          </span>
                          {song?.id === t.id && (
                            <span className="text-xs font-bold text-primary">Selected</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Trim — the one control that only exists after posting. */}
              {canTrim && (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Scissors className="size-3.5" /> Trim clip
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {trimmed ? `${formatTime(trimmedLength)} selected` : "Full length"}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <label htmlFor="trim-start">Start</label>
                      <span>{formatTime(trimStart)}</span>
                    </div>
                    <input
                      id="trim-start"
                      type="range"
                      min={0}
                      max={Math.max(0, duration)}
                      step={0.1}
                      value={trimStart}
                      disabled={!duration || saving}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setStart(Math.min(v, trimEnd - MIN_TRIM_SECONDS));
                        seekTo(v);
                      }}
                      className="w-full accent-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <label htmlFor="trim-end">End</label>
                      <span>{formatTime(trimEnd)}</span>
                    </div>
                    <input
                      id="trim-end"
                      type="range"
                      min={0}
                      max={Math.max(0, duration)}
                      step={0.1}
                      value={trimEnd}
                      disabled={!duration || saving}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setEnd(Math.max(v, trimStart + MIN_TRIM_SECONDS));
                        seekTo(v);
                      }}
                      className="w-full accent-primary"
                    />
                  </div>

                  {trimmed && (
                    <button
                      type="button"
                      onClick={() => {
                        setStart(0);
                        setEnd(duration);
                        seekTo(0);
                      }}
                      className="text-[11px] font-medium text-primary hover:underline"
                      disabled={saving}
                    >
                      Reset to full length
                    </button>
                  )}
                </div>
              )}

              {/* Paid — same switch and price picker as the post form. */}
              {!isImage && (
                <PaidVideoFields
                  enabled={isPaid}
                  onEnabledChange={setIsPaid}
                  priceCents={priceCents}
                  onPriceCentsChange={setPriceCents}
                />
              )}

              {progress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{progress.stage}…</span>
                    <span>{progress.percent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            ) : trimmed ? (
              "Save trimmed video"
            ) : (
              "Save changes"
            )}
          </Button>
        </footer>
      </div>

      <SoundPickerDialog
        open={soundPickerOpen}
        onOpenChange={setSoundPickerOpen}
        selectedSound={chosenSound}
        onSelect={setChosenSound}
        originalLabel={`Original sound - @${username || video.username}`}
      />
    </div>
  );
}
