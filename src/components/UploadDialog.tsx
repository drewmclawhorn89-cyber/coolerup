import { useEffect, useState } from "react";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { ME, uploadVideo } from "@/lib/loop";

export function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [username, setUsername] = useState(ME);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Please choose a video file");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast.error("Videos must be under 50 MB");
      return;
    }
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !username.trim()) return;
    setBusy(true);
    try {
      await uploadVideo(file, username.trim().replace(/^@/, "").slice(0, 40), caption.trim().slice(0, 500));
      toast.success("Your video is live!");
      onDone();
    } catch {
      toast.error("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl gap-6 rounded-2xl border bg-card p-6"
      >
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0]);
          }}
          className="flex aspect-[9/16] w-48 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed bg-secondary text-center text-sm text-muted-foreground"
        >
          {preview ? (
            <video src={preview} autoPlay muted loop playsInline className="h-full w-full object-cover" />
          ) : (
            <>
              <Upload className="h-8 w-8 text-primary" />
              Drop a video or click to choose
              <span className="text-xs">MP4 / WebM, up to 50 MB</span>
            </>
          )}
          <input type="file" accept="video/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">Upload video</h2>
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
          <button
            disabled={!file || busy}
            className="mt-auto rounded-full bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Post"}
          </button>
        </div>
      </form>
    </div>
  );
}
