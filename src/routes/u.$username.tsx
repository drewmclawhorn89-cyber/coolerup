import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Heart, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoCard } from "@/components/VideoCard";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyLikes, formatCount, resolveVideoUrl, type Video } from "@/lib/loop";

export const Route = createFileRoute("/u/$username")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} on Loop` },
      { name: "description", content: `Watch every video from @${params.username} on Loop.` },
      { property: "og:title", content: `@${params.username} on Loop` },
      { property: "og:description", content: `Watch every video from @${params.username} on Loop.` },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { username } = Route.useParams();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [muted, setMuted] = useState(true);
const [showEdit, setShowEdit] = useState(false);
const [editBio, setEditBio] = useState("");
const [editUsername, setEditUsername] = useState("");
  useEffect(() => {
    setVideos(null);
    supabase
      .from("videos")
      .select("*")
      .eq("username", username)
      .order("created_at", { ascending: false })
      .then(({ data }) => setVideos((data ?? []) as Video[]));
    fetchMyLikes().then(setLiked).catch(() => {});
  }, [username]);

  const totalLikes = (videos ?? []).reduce((n, v) => n + v.likes_count, 0);

  return (
    <div className="min-h-dvh bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-4xl px-4 pt-[calc(1rem+env(safe-area-inset-top))] md:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> loop<span className="text-primary">.</span>
        </Link>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary font-display text-4xl uppercase text-primary-foreground">
            {username[0]}
          </div>
          <h1 className="font-display text-2xl break-all">@{username}</h1>
        <button onClick={() => { setEditUsername(username||""); setShowEdit(true); }} className="mt-3 bg-white text-black px-6 py-2.5 rounded-full text-sm font-bold">Edit Profile</button>
        <div className="flex gap-8 text-sm">
          <span><b className="text-lg">{videos?.length ?? "-"}</b> <span className="text-muted-foreground">videos</span></span>
          <span><b className="text-lg">{formatCount(totalLikes)}</b> <span className="text-muted-foreground">likes</span></span>
        </div>
          
            
            
          
        
        {videos === null && <p className="py-20 text-center text-muted-foreground">Loading…</p>}
        {videos?.length === 0 && <p className="py-20 text-center text-muted-foreground">No videos yet.</p>}
        <div className="grid grid-cols-3 gap-1 md:gap-2">
          {videos?.map((v, i) => <Tile key={v.id} video={v} onClick={() => setOpen(i)} />)}
        </div>
      </div>

      {open !== null && videos && (
        <Viewer start={open} onClose={() => setOpen(null)}>
          {videos.map((v) => (
            <div key={v.id} className="h-dvh snap-start" data-video>
              <VideoCard
                video={v}
                liked={liked.has(v.id)}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onLikeChange={(on) =>
                  setLiked((s) => {
                    const n = new Set(s);
                    if (on) n.add(v.id);
                    else n.delete(v.id);
                    return n;
                  })
                }
              />
            </div>
          ))}
         </Viewer>
      ))}

      {showEdit && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-sm border border-zinc-800">
            <h2 className="text-white font-bold text-lg mb-4">Edit Profile</h2>
            <input value={editUsername} onChange={e=>setEditUsername(e.target.value)} placeholder="Username" className="w-full bg-zinc-800 text-white rounded-lg p-3 mb-3" />
            <textarea value={editBio} onChange={e=>setEditBio(e.target.value)} placeholder="Bio" maxLength={150} className="w-full bg-zinc-800 text-white rounded-lg p-3 mb-4 h-24" />
            <div className="flex gap-2">
              <button onClick={()=>setShowEdit(false)} className="flex-1 bg-zinc-700 text-white py-2.5 rounded-full">Cancel</button>
              <button onClick={async()=>{
                const { error } = await supabase.from('profiles').update({ username: editUsername, bio: editBio }).eq('username', username);
                if(error){ alert(error.message) } else { setShowEdit(false); location.href = `/u/${editUsername}` }
              }} className="flex-1 bg-white text-black py-2.5 rounded-full font-bold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
} 

function Tile({ video, onClick }: { video: Video; onClick: () => void }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    resolveVideoUrl(video.video_url).then(setSrc);
  }, [video.video_url]);
  return (
    <button onClick={onClick} className="relative aspect-[9/16] overflow-hidden rounded-md bg-card md:rounded-xl">
      {src && <video src={`${src}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
      <span className="absolute bottom-1 left-2 flex items-center gap-1 text-xs font-bold drop-shadow">
        <Play className="h-3 w-3 fill-current" /> <Heart className="h-3 w-3" /> {formatCount(video.likes_count)}
      </span>
    </button>
  );
}

function Viewer({ start, onClose, children }: { start: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll("[data-video]")[start]?.scrollIntoView();
  }, [start]);
  return (
    <div className="fixed inset-0 z-40 bg-background">
      <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="absolute left-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-10 rounded-full bg-overlay">
        <X />
      </Button>
      <div ref={ref} className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-scroll">{children}</div>
    </div>
  );
}
