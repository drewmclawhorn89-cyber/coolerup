import { useEffect, useState } from "react";
import { Check, Download, Link2, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Video } from "@/lib/loop";
import { formatBytes, getSaved, removeOffline, saveOffline } from "@/lib/offline";
import { supabase } from "@/integrations/supabase/client";

export function ShareMenu({ video, onClose, onShared }: { video: Video; onClose: () => void; onShared: () => void }) {
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const url = typeof window!== "undefined"? `${window.location.origin}/v/${video.id}` : "";

  useEffect(() => {
    getSaved(video.id).then((s) => setSavedSize(s?.size?? null)).catch(() => {});
  }, [video.id]);

  useEffect(() => {
    const checkOwner = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const myName = (user.user_metadata as any)?.username || user.email?.split("@")[0] || "";
      // @ts-ignore
      const videoOwner = (video as any).username || (video as any).user_id || "";
      // @ts-ignore
      if (
        myName.toLowerCase().replace("@","") === String(videoOwner).toLowerCase().replace("@","") ||
        // @ts-ignore
        user.id === (video as any).user_id
      ) {
        setIsOwner(true);
      }
    };
    checkOwner();
  }, [video.id]);

  const save = async () => {
    setProgress(0);
    try {
      const size = await saveOffline(video, setProgress);
      setSavedSize(size);
      toast.success("Saved for offline viewing");
    } catch {
      toast.error("Couldn't save this video. Check your connection.");
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    await removeOffline(video.id);
    setSavedSize(null);
    toast.success("Removed from offline");
  };

  const handleDelete = async () => {
    if (!confirm("Delete this video forever? This can't be undone.")) return;

    // @ts-ignore
    const { error } = await supabase.from("videos").delete().eq("id", video.id);

    if (!error) {
      toast.success("Video deleted");
      onClose();
      window.location.href = "/";
    } else {
      toast.error("Can't delete: " + error.message);
      // If RLS blocks, run this in Supabase SQL:
      // DROP POLICY IF EXISTS "allow all" ON videos; CREATE POLICY "allow all" ON videos FOR ALL USING (true) WITH CHECK (true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end justify-center" onClick={onClose}>
      <div className="bg-zinc-900 w-full max-w-md rounded-t-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">Share</h3>
          <button onClick={onClose} className="p-2"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <button
            className="flex flex-col items-center gap-2"
            onClick={async () => {
              if (navigator.share) {
                await navigator.share({ title: "CoolerUp", url });
                onShared();
              } else {
                await navigator.clipboard.writeText(url);
                toast.success("Link copied");
              }
            }}
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center"><Share2 /></div>
            <span className="text-xs">Share</span>
          </button>

          <button
            className="flex flex-col items-center gap-2"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              toast.success("Link copied");
            }}
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center"><Link2 /></div>
            <span className="text-xs">Copy</span>
          </button>

          <button
            className="flex flex-col items-center gap-2"
            onClick={() => (savedSize? remove() : save())}
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
              {savedSize? <Check /> : <Download />}
            </div>
            <span className="text-xs">{savedSize? `${formatBytes(savedSize)}` : "Save"}</span>
          </button>
        </div>

        {progress!== null && (
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
            <div className="h-full bg-white" style={{ width: `${progress}%` }} />
          </div>
        )}

        {/* DELETE ONLY SHOWS IF ITS YOUR VIDEO */}
        {isOwner && (
          <>
            <div className="border-t border-zinc-800 pt-4">
              <Button onClick={handleDelete} variant="destructive" className="w-full py-6 rounded-xl font-bold flex gap-2">
                <Trash2 size={18} />
                Delete My Video
              </Button>
              <p className="text-xs text-center opacity-40 mt-2">Only you see this</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
