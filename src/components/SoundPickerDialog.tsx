import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Music, Pause, Play, Search, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCount } from "@/lib/loop";
import { getTrendingSounds, soundAudioUrl, type Sound } from "@/lib/sounds";

type Mode = "choose" | "browse";

export function SoundPickerDialog({
  open,
  onOpenChange,
  selectedSound,
  onSelect,
  originalLabel,
  title = "Add sound?",
  description = "Keep your voice, or use an original sound from another Coolerup video.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSound: Sound | null;
  onSelect: (sound: Sound | null) => void;
  /** e.g. "Your voice" or "Original sound - @you" */
  originalLabel?: string;
  title?: string;
  description?: string;
}) {
  const [mode, setMode] = useState<Mode>("choose");
  const [query, setQuery] = useState("");
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef(0);

  const stopPreview = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  };

  const load = async (q: string) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const rows = await getTrendingSounds(30, q);
      if (requestRef.current === request) setSounds(rows);
    } catch {
      if (requestRef.current === request) toast.error("Couldn't load sounds");
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      stopPreview();
      setMode("choose");
      setQuery("");
      return;
    }
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "browse") return;
    const t = setTimeout(() => void load(query), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, open]);

  useEffect(() => () => stopPreview(), []);

  const preview = async (sound: Sound) => {
    if (playingId === sound.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const url = await soundAudioUrl(sound);
    if (!url) {
      toast.error("This sound can't be previewed");
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(sound.id);
    audio.onended = () => setPlayingId((id) => (id === sound.id ? null : id));
    void audio.play().catch(() => {
      setPlayingId(null);
      toast.error("Tap again to preview this sound");
    });
  };

  const choose = (sound: Sound | null) => {
    stopPreview();
    onSelect(sound);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => choose(null)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
              selectedSound === null
                ? "border-[#fe2c55] bg-[#fe2c55]/10"
                : "border-border hover:border-foreground/30 hover:bg-accent"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
              <Volume2 className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Keep original sound</span>
              <span className="block truncate text-xs text-muted-foreground">
                {originalLabel || "Your voice"}
              </span>
            </span>
            {selectedSound === null && <Check className="h-5 w-5 shrink-0 text-[#fe2c55]" />}
          </button>

          <button
            type="button"
            onClick={() => setMode("browse")}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
              selectedSound
                ? "border-[#fe2c55] bg-[#fe2c55]/10"
                : "border-border hover:border-foreground/30 hover:bg-accent"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary">
              <Music className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Use sound from video</span>
              <span className="block truncate text-xs text-muted-foreground">
                {selectedSound
                  ? `${selectedSound.title} · @${selectedSound.creator_username}`
                  : "Search trending original sounds"}
              </span>
            </span>
            {selectedSound && <Check className="h-5 w-5 shrink-0 text-[#fe2c55]" />}
          </button>
        </div>

        {mode === "browse" && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-full bg-secondary px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sounds or @creators"
                aria-label="Search sounds"
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>

            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {query.trim() ? "Results" : "Trending sounds"}
            </p>

            <div className="max-h-[38dvh] space-y-1 overflow-y-auto pr-1">
              {loading && sounds.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading sounds…
                </div>
              ) : sounds.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No sounds found. Try another search.
                </p>
              ) : (
                sounds.map((sound) => {
                  const selected = selectedSound?.id === sound.id;
                  return (
                    <div
                      key={sound.id}
                      className={`flex items-center gap-2 rounded-lg p-2 ${
                        selected ? "bg-[#fe2c55]/15" : "hover:bg-secondary"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => choose(sound)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                          <Music className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {sound.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            @{sound.creator_username} · {formatCount(sound.uses_count)} uses
                          </span>
                        </span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-[#fe2c55]" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void preview(sound)}
                        aria-label={playingId === sound.id ? "Pause preview" : "Play preview"}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60"
                      >
                        {playingId === sound.id ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4 fill-current" />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <p className="text-[11px] leading-tight text-muted-foreground">
              Every sound is an original sound from a user video — no commercial music, so no
              copyright strikes.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
