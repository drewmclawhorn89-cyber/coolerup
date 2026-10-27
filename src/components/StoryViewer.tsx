import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deleteStory, resolveStoryUrl, type Story } from "@/lib/stories";

const IMAGE_MS = 5000;

export function StoryViewer({
  stories,
  isOwn,
  onClose,
  onDeleted,
}: {
  stories: Story[];
  isOwn: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState("");
  const story = stories[index];

  useEffect(() => {
    if (!story) return;
    let alive = true;
    setSrc("");
    resolveStoryUrl(story.media_url).then((u) => { if (alive) setSrc(u); });
    return () => { alive = false; };
  }, [story?.id]);

  const next = () => (index + 1 < stories.length ? setIndex(index + 1) : onClose());
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    if (!story || !src || story.media_type === "video") return;
    const t = setTimeout(next, IMAGE_MS);
    return () => clearTimeout(t);
  }, [story?.id, src]);

  useEffect(() => { if (!story) onClose(); }, [story]);
  if (!story) return null;

  async function remove() {
    try {
      await deleteStory(story!.id);
      onDeleted(story!.id);
      setIndex((i) => Math.max(0, Math.min(i, stories.length - 2)));
    } catch {
      toast.error("Couldn't delete story");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="absolute inset-x-2 z-10 flex gap-1" style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}>
        {stories.map((s, i) => (
          <div key={s.id} className="h-1 flex-1 overflow-hidden rounded bg-white/30">
            <div className={`h-full bg-white ${i < index ? "w-full" : "w-0"}`} />
          </div>
        ))}
      </div>
      <button aria-label="Close story" onClick={onClose} className="absolute right-3 z-20 text-white" style={{ top: "calc(env(safe-area-inset-top) + 20px)" }}>
        <X />
      </button>
      {isOwn && (
        <button aria-label="Delete story" onClick={remove} className="absolute left-3 z-20 text-white" style={{ top: "calc(env(safe-area-inset-top) + 20px)" }}>
          <Trash2 className="h-5 w-5" />
        </button>
      )}
      {src && (story.media_type === "video"
        ? <video key={story.id} src={src} autoPlay playsInline onEnded={next} className="max-h-dvh w-full object-contain" />
        : <img key={story.id} src={src} alt="Story" className="max-h-dvh w-full object-contain" />)}
      <button aria-label="Previous" onClick={prev} className="absolute inset-y-16 left-0 w-1/3" />
      <button aria-label="Next" onClick={next} className="absolute inset-y-16 right-0 w-1/3" />
    </div>
  );
}
