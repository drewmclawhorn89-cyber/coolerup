import { useEffect, useRef, useState } from "react";
import { Camera, Music, RefreshCw, RotateCcw, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FilterBar } from "@/components/FilterBar";
import { AnimalOverlay } from "@/components/AnimalOverlay";
import { getAnimal, drawAnimal, mirrorFace } from "@/lib/animals";
import { useFaceTracker } from "@/lib/face";
import { CAMERA_FILTERS, canBakeFilters } from "@/lib/filters";
import { songStreamUrl, uploadVideo, type Song } from "@/lib/loop";
import { fetchTracks, type Track } from "@/components/MusicPlayer";

const MGK_QUERY = "mgk machine gun kelly";

type FacingMode = "user" | "environment";

export function PhotoDialog({
  open,
  onOpenChange,
  username,
  onPosted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username?: string | null;
  onPosted?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filterId, setFilterId] = useState("none");
  const [animalId, setAnimalId] = useState("");
  const animal = getAnimal(animalId);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const faceRef = useFaceTracker(videoRef, !!animal && open && !photo);
  const [previewUrl, setPreviewUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [song, setSong] = useState<Song | null>(null);
  const [songQ, setSongQ] = useState(MGK_QUERY);
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bake = canBakeFilters();

  async function findSongs(query: string) {
    setSongQ(query);
    setSearching(true);
    try {
      setResults((await fetchTracks(query)).slice(0, 10));
    } catch {
      toast.error("Couldn't load songs");
    } finally {
      setSearching(false);
    }
  }

  function chooseSong(t: Track) {
    audioRef.current?.pause();
    if (song?.id === t.id) {
      setSong(null);
      return;
    }
    setSong({ id: t.id, title: t.title, artist: t.artist });
    const a = new Audio(songStreamUrl(t.id));
    audioRef.current = a;
    void a.play().catch(() => {});
  }

  useEffect(() => {
    if (photo && pickerOpen && results.length === 0) void findSongs(MGK_QUERY);
  }, [photo, pickerOpen]);
  useEffect(() => {
    if (!open || !photo) audioRef.current?.pause();
  }, [open, photo]);
  const filter = CAMERA_FILTERS.find((f) => f.id === filterId) ?? CAMERA_FILTERS[0]!;

  useEffect(() => {
    if (!open || photo) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Your browser doesn't support camera access.");
      return;
    }
    let cancelled = false;
    setReady(false);
    setError("");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("Camera access was blocked. Allow it in your browser settings and try again.");
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, facingMode, photo, attempt]);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (bake) ctx.filter = filter.css;
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    if (faceRef.current) drawAnimal(ctx, animal, facingMode === "user" ? mirrorFace(faceRef.current, canvas.width) : faceRef.current);
    canvas.toBlob((b) => b && setPhoto(b), "image/jpeg", 0.92);
  }

  function reset() {
    setPhoto(null);
    setCaption("");
    setPosting(false);
    setFilterId("none");
    setAnimalId("");
    audioRef.current?.pause();
    setSong(null);
    setPickerOpen(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (posting) return;
      reset();
    }
    onOpenChange(next);
  }

  async function post() {
    if (!photo) return;
    if (!username) {
      toast.error("Finish setting up your profile before posting");
      return;
    }
    setPosting(true);
    try {
      const file = new File([photo], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      await uploadVideo(file, username, caption.trim().slice(0, 500), song);
      toast.success("Your photo is posted!");
      reset();
      onOpenChange(false);
      onPosted?.();
    } catch {
      toast.error("Upload failed. Try again.");
      setPosting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="block h-[100dvh] w-screen max-w-none gap-0 overflow-hidden border-0 bg-black p-0 text-white sm:aspect-[9/16] sm:h-[min(100dvh,56rem)] sm:w-auto sm:rounded-2xl [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Take a photo</DialogTitle>
        <DialogDescription className="sr-only">Take a photo, pick a filter, and post it to your feed.</DialogDescription>
        <div className="relative h-full w-full bg-black">
          {!photo ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ filter: filter.css }}
              className={`h-full w-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""} ${ready ? "opacity-100" : "opacity-0"}`}
            />
          ) : (
            previewUrl && <img src={previewUrl} alt="Your photo" className="h-full w-full object-cover" />
          )}

          {!photo && <AnimalOverlay animal={animal} videoRef={videoRef} faceRef={faceRef} mirror={facingMode === "user"} />}

          {!photo && !ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
              <Camera className="h-8 w-8" />
              <p className="text-sm text-white/80">{error || "Starting your camera…"}</p>
              {error && (
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-full bg-white px-6 py-2.5 font-bold text-black">
                  Try again
                </button>
              )}
            </div>
          )}

          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <button type="button" onClick={() => handleOpenChange(false)} aria-label="Close" disabled={posting} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 disabled:opacity-50">
              <X className="h-6 w-6" />
            </button>
            {!photo ? (
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === "user" ? "environment" : "user"))}
                aria-label="Switch camera"
                disabled={!ready}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 disabled:opacity-40"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            ) : (
              <span className="h-10 w-10" />
            )}
          </div>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12">
            {!photo ? (
              <>
                {!bake && <p className="pb-2 text-center text-xs text-white/70">Filters can't be saved on this browser, so photos will post unfiltered.</p>}
                <FilterBar value={filterId} onChange={setFilterId} animal={animalId} onAnimalChange={setAnimalId} />
                <div className="flex justify-center">
                  <button type="button" onClick={snap} disabled={!ready} aria-label="Take photo" className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white transition disabled:opacity-40">
                    <span className="h-16 w-16 rounded-full bg-white" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={500}
                  placeholder="Add a caption…"
                  aria-label="Caption"
                  className="w-full rounded-full bg-white/15 px-4 py-3 text-base text-white outline-none placeholder:text-white/60 focus:ring-2 focus:ring-white/70"
                />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPickerOpen((v) => !v)} className="flex min-w-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold">
                    <Music className="h-4 w-4 shrink-0" /> <span className="truncate">{song ? song.title : "Add a song"}</span>
                  </button>
                  {song && <button type="button" onClick={() => { audioRef.current?.pause(); setSong(null); }} aria-label="Remove song" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15"><X className="h-4 w-4" /></button>}
                </div>
                {pickerOpen && (
                  <div className="rounded-2xl bg-black/60 p-2 text-sm">
                    <div className="mb-2 flex gap-2">
                      <button type="button" onClick={() => void findSongs(MGK_QUERY)} className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">MGK</button>
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/15 px-3">
                        <Search className="h-4 w-4 shrink-0" />
                        <input value={songQ} onChange={(e) => setSongQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void findSongs(songQ); } }} placeholder="Search songs" aria-label="Search songs" className="h-8 w-full bg-transparent text-base outline-none placeholder:text-white/60" />
                      </div>
                    </div>
                    <div className="max-h-[28dvh] space-y-1 overflow-y-auto">
                      {searching ? <p className="py-2 text-center text-white/70">Loading…</p> : results.map((t) => (
                        <button type="button" key={t.id} onClick={() => chooseSong(t)} className={`flex w-full items-center gap-2 rounded-lg p-2 text-left ${song?.id === t.id ? "bg-white/25" : "hover:bg-white/10"}`}>
                          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{t.title}</span><span className="block truncate text-xs text-white/70">{t.artist}</span></span>
                          {song?.id === t.id && <span className="text-xs font-bold">Selected</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setPhoto(null)} disabled={posting} className="flex items-center justify-center gap-2 rounded-full border border-white/70 py-3 font-bold disabled:opacity-50">
                    <RotateCcw className="h-5 w-5" /> Retake
                  </button>
                  <button type="button" onClick={post} disabled={posting} className="flex items-center justify-center gap-2 rounded-full bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50">
                    <Send className="h-5 w-5" /> {posting ? "Posting…" : "Post"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
