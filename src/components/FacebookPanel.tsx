import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Facebook, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { normalizeFacebookVideoUrl } from "@/lib/facebook";
import { FacebookPlayer } from "@/components/FacebookPlayer";

const KEY = "coolerup:facebook-videos";

/** Paste a Facebook video link; it plays from Facebook's embed. Nothing is downloaded or uploaded. */
export function FacebookPanel() {
  const [links, setLinks] = useState<string[]>([]);
  const [value, setValue] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(saved)) setLinks(saved.filter((l) => typeof l === "string" && normalizeFacebookVideoUrl(l)));
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (next: string[]) => {
    setLinks(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeFacebookVideoUrl(value);
    if (!url) {
      toast.error("Paste a link from Facebook (video, reel, share or fb.watch)");
      return;
    }
    persist([url, ...links.filter((l) => l !== url)]);
    setValue("");
  };

  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-2 text-white">
      <form onSubmit={onSubmit} className="mx-auto flex max-w-xl gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste Facebook video link"
          className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-sm outline-none"
        />
        <button type="submit" className="rounded-full bg-[#1877f2] px-4 py-2 text-sm font-semibold">
          Add
        </button>
      </form>
      <p className="mx-auto mt-2 max-w-xl text-center text-[11px] text-white/60">
        Plays from Facebook&apos;s own player. Videos are never downloaded or re-uploaded.
      </p>
      <div className="mx-auto mt-4 flex max-w-xl flex-col gap-5">
        {links.map((link) => (
          <div key={link}>
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-[#1877f2] px-3 py-2 text-sm font-semibold">
              <Facebook className="size-4" /> Playing from Facebook
              <a href={link} target="_blank" rel="noopener noreferrer" className="ml-auto" aria-label="Open on Facebook">
                <ExternalLink className="size-4" />
              </a>
              <button type="button" onClick={() => persist(links.filter((l) => l !== link))} aria-label="Remove">
                <Trash2 className="size-4" />
              </button>
            </div>
            <FacebookPlayer url={link} />
          </div>
        ))}
      </div>
    </div>
  );
}
