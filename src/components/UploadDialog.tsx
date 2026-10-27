import { useEffect, useRef, useState } from "react";
import { Music, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { readBool } from "@/lib/prefs";
import { songStreamUrl, uploadVideo, type Song } from "@/lib/loop";
import { fetchTracks, type Track } from "@/components/MusicPlayer";

export function UploadDialog({
  onClose,
  onDone,
  defaultUsername,
}: {
  onClose: () => void;
  onDone: () => void;
  defaultUsername: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const file = files[0] ?? null;
  const [preview, setPreview] = useState("");
  const [username, setUsername] = useState(defaultUsername);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [song, setSong] = useState<Song | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPhoto = Boolean(file?.type.startsWith("image/"));

  const findSongs = async () => {
    setSearching(true);
    try { setResults((await fetchTracks(q)).slice(0, 10)); } catch { toast.error("Couldn't load songs"); } finally { setSearching(false); }
  };
  useEffect(() => { if (isPhoto && results.length === 0) void findSongs(); }, [isPhoto]);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  useEffect(() => { if (!isPhoto) { setSong(null); audioRef.current?.pause(); setPreviewId(""); } }, [isPhoto]);
  const choose = (t: Track) => {
    audioRef.current?.pause();
    if (song?.id === t.id) { setSong(null); setPreviewId(""); return; }
    setSong({ id: t.id, title: t.title, artist: t.artist });
    const a = new Audio(songStreamUrl(t.id));
    audioRef.current = a;
    setPreviewId(t.id);
    void a.play().catch(() => {});
  };

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (list?: FileList | null) => {
    const valid: File[] = [];
    for (const f of Array.from(list ?? [])) {
      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) continue;
      valid.push(f);
    }
    if (list && list.length > 0 && valid.length === 0) toast.error("Please choose a video or photo");
    if (valid.length) setFiles(valid);
  };
  const unusedPick = (f: File) => {
    const isImage = f.type.startsWith("image/");
    if (!isImage && !f.type.startsWith("video/")) {
      toast.error("Please choose a video or photo");
      return;
    }
    if (isImage && f.size > 500 * 2024 * 2024) {
      toast.error("Photos must be under ");
      return;
    }
    if (!isImage && f.size > 500 * 2024 * 2024) {
      toast.error("Videos must be under  ");
      return;
    }
    setFiles([f]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !username.trim()) return;
    const conn = (navigator as unknown as { connection?: { type?: string } }).connection;
    if (readBool("wifi-upload") && conn?.type === "cellular") {
      toast.error("Upload over Wi-Fi only is on. Connect to Wi-Fi to post.");
      return;
    }
    const name = username.trim().replace(/^@/, "").slice(0, 40);
    const cap = caption.trim().slice(0, 500);
    const batch = files;
    const chosenSong = song;
    // Close immediately and upload in the background so posting feels instant.
    onClose();
    toast.promise(
      (async () => {
        for (const f of batch) {
          await uploadVideo(f, name, cap, f.type.startsWith("image/") ? chosenSong : null);
        }
        onDone();
      })(),
      {
        loading: batch.length > 1 ? `Posting ${batch.length} items…` : "Posting…",
        success: batch.length > 1 ? `${batch.length} posts uploaded!` : "Your post is up!",
        error: "Upload failed. Try again.",
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-3 sm:p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-2xl border bg-card p-4 sm:flex-row sm:gap-6 sm:p-6"
      >
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files);
          }}
          className="flex h-40 w-full shrink-0 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed bg-secondary text-center text-sm text-muted-foreground sm:aspect-[9/16] sm:h-auto sm:w-48"
        >
          {preview ? (
            file?.type.startsWith("image/") ? (
              <img src={preview} alt="Preview" className="h-full w-full object-cover" />
            ) : (
              <video src={preview} autoPlay muted loop playsInline className="h-full w-full object-cover" />
            )
          ) : (
            <>
              <Upload className="h-8 w-8 text-primary" />
              Drop videos or photos, or click to choose
              <span className="text-xs">     </span>
            </>
          )}
          <input type="file" multiple accept="video/*,image/*" className="hidden" onChange={(e) => pick(e.target.files)} />
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-4 [&_input]:text-base [&_textarea]:text-base">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">Upload</h2>
            <button type="button" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <label className="text-sm font-semibold">
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={40}
              required
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
              className="mt-1 w-full resize-none rounded-lg bg-secondary px-3 py-2 font-normal outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {isPhoto && (
            <div className="min-w-0 text-sm">
              <div className="mb-1 flex items-center gap-2 font-semibold"><Music className="h-4 w-4 text-primary" /> Add a song{song && <span className="min-w-0 truncate font-normal text-muted-foreground">· {song.title}</span>}</div>
              <button type="button" onClick={() => { const v = "mgk machine gun kelly"; setQ(v); setSearching(true); fetchTracks(v).then((r) => setResults(r.slice(0, 10))).catch(() => toast.error("Couldn't load songs")).finally(() => setSearching(false)); }} className="mb-2 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">MGK</button>
              <div className="mb-2 flex items-center gap-2 rounded-full bg-secondary px-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void findSongs(); } }} placeholder="Search songs" className="h-9 w-full bg-transparent outline-none" />
              </div>
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {searching ? <p className="py-2 text-muted-foreground">Loading…</p> : results.map((t) => (
                  <button type="button" key={t.id} onClick={() => choose(t)} className={`flex w-full items-center gap-2 rounded-lg p-2 text-left ${song?.id === t.id ? "bg-primary/20" : "hover:bg-secondary"}`}>
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{t.title}</span><span className="block truncate text-xs text-muted-foreground">{t.artist}</span></span>
                    {song?.id === t.id && <span className="text-xs font-bold text-primary">Selected</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            disabled={!file || busy}
            className="mt-auto rounded-full bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Uploading…" : files.length > 1 ? `Post ${files.length}` : "Post"}
          </button>
        </div>
      </form>
    </div>
  );
}
