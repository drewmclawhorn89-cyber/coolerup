import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteStory,
  fetchLikedStoryIds,
  resolveStoryUrl,
  setStoryLiked,
  type Story,
} from "@/lib/stories";
import { formatCount } from "@/lib/loop";
import { haptic } from "@/lib/prefs";

const IMAGE_MS = 5000;

export function StoryViewer({
  stories,
  isOwn,
  onClose,
  onDeleted,
  onLikeChange,
}: {
  stories: Story[];
  isOwn: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
  /** Lets the parent keep its story list in sync with the new like count. */
  onLikeChange?: (storyId: string, liked: boolean, count: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState("");
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [burst, setBurst] = useState(false);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const story = stories[index];

  useEffect(() => {
    fetchLikedStoryIds()
      .then(setLikedIds)
      .catch(() => {});
  }, []);

  // Seed counts from the rows we were handed, then keep them local.
  useEffect(() => {
    setCounts((prev) => {
      const next = { ...prev };
      for (const s of stories) {
        if (next[s.id] === undefined) next[s.id] = s.likes_count ?? 0;
      }
      return next;
    });
  }, [stories]);

  useEffect(() => {
    if (!story) return;
    let alive = true;
    setSrc("");
    resolveStoryUrl(story.media_url).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [story?.id]);

  const next = () => (index + 1 < stories.length ? setIndex(index + 1) : onClose());
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    if (!story || !src || story.media_type === "video") return;
    const t = setTimeout(next, IMAGE_MS);
    return () => clearTimeout(t);
  }, [story?.id, src]);

  useEffect(() => {
    if (!story) onClose();
  }, [story]);

  useEffect(
    () => () => {
      if (burstTimer.current) clearTimeout(burstTimer.current);
    },
    [],
  );

  const toggleLike = useCallback(
    async (target: Story) => {
      const wasLiked = likedIds.has(target.id);
      const nextLiked = !wasLiked;
      const base = counts[target.id] ?? target.likes_count ?? 0;
      const nextCount = Math.max(0, base + (nextLiked ? 1 : -1));

      haptic();
      setLikedIds((prev) => {
        const n = new Set(prev);
        if (nextLiked) n.add(target.id);
        else n.delete(target.id);
        return n;
      });
      setCounts((prev) => ({ ...prev, [target.id]: nextCount }));
      onLikeChange?.(target.id, nextLiked, nextCount);

      if (nextLiked) {
        setBurst(true);
        if (burstTimer.current) clearTimeout(burstTimer.current);
        burstTimer.current = setTimeout(() => setBurst(false), 650);
      }

      try {
        await setStoryLiked(target, nextLiked);
      } catch {
        // Roll back the optimistic UI.
        setLikedIds((prev) => {
          const n = new Set(prev);
          if (nextLiked) n.delete(target.id);
          else n.add(target.id);
          return n;
        });
        setCounts((prev) => ({ ...prev, [target.id]: base }));
        onLikeChange?.(target.id, wasLiked, base);
        toast.error("Couldn't update like");
      }
    },
    [counts, likedIds, onLikeChange],
  );

  async function remove() {
    try {
      await deleteStory(story!.id);
      onDeleted(story!.id);
      setIndex((i) => Math.max(0, Math.min(i, stories.length - 2)));
    } catch {
      toast.error("Couldn't delete story");
    }
  }

  if (!story) return null;

  const liked = likedIds.has(story.id);
  const count = counts[story.id] ?? story.likes_count ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="absolute inset-x-2 z-10 flex gap-1" style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}>
        {stories.map((s, i) => (
          <div key={s.id} className="h-1 flex-1 overflow-hidden rounded bg-white/30">
            <div className={`h-full bg-white ${i < index ? "w-full" : "w-0"}`} />
          </div>
        ))}
      </div>
      <button
        aria-label="Close story"
        onClick={onClose}
        className="absolute right-3 z-20 text-white"
        style={{ top: "calc(env(safe-area-inset-top) + 20px)" }}
      >
        <X />
      </button>
      {isOwn && (
        <button
          aria-label="Delete story"
          onClick={remove}
          className="absolute left-3 z-20 text-white"
          style={{ top: "calc(env(safe-area-inset-top) + 20px)" }}
        >
          <Trash2 className="h-5 w-5" />
        </button>
      )}
      {src &&
        (story.media_type === "video" ? (
          <video
            key={story.id}
            src={src}
            autoPlay
            playsInline
            onEnded={next}
            onDoubleClick={() => void toggleLike(story)}
            className="max-h-dvh w-full object-contain"
          />
        ) : (
          <img
            key={story.id}
            src={src}
            alt="Story"
            onDoubleClick={() => void toggleLike(story)}
            className="max-h-dvh w-full object-contain"
          />
        ))}

      {burst && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Heart className="heart-pop h-28 w-28 fill-primary text-primary drop-shadow-[0_0_24px_rgba(255,45,85,0.8)]" />
        </div>
      )}

      <button aria-label="Previous" onClick={prev} className="absolute inset-y-16 left-0 w-1/3" />
      <button aria-label="Next" onClick={next} className="absolute inset-y-16 right-0 w-1/3" />

      {/* Like control — above the tap zones so it never skips the story. */}
      <div
        className="absolute right-3 z-30 flex flex-col items-center gap-1"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void toggleLike(story);
          }}
          aria-label={liked ? "Unlike story" : "Like story"}
          aria-pressed={liked}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition active:scale-90"
        >
          <Heart className={`h-7 w-7 transition ${liked ? "fill-primary text-primary" : "text-white"}`} />
        </button>
        <span className={`text-[12px] font-bold ${liked ? "text-primary" : "text-white"}`}>
          {formatCount(count)}
        </span>
      </div>
    </div>
  );
}
