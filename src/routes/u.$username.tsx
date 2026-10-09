import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "lucide-react";

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function Profile() {
  const { username } = Route.useParams();
  const [videos, setVideos] = useState<any[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    supabase.from("videos").select("*").eq("username", username).order("created_at", { ascending: false }).then(({ data }) => {
      setVideos(data || []);
    });
  }, [username]);

  const totalLikes = (videos || []).reduce((a, v) => a + (v.likes_count || 0), 0);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>

        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-4xl uppercase text-primary-foreground">
            {username?.[0]}
          </div>
          <h1 className="text-2xl">@{username}</h1>
          <div className="flex gap-8 text-sm">
            <span><b>{videos?.length?? "-"}</b> videos</span>
            <span><b>{totalLikes}</b> likes</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {videos?.map((v, i) => (
            <button key={v.id} onClick={() => setOpen(i)} className="relative aspect-[9/16] overflow-hidden rounded-md bg-zinc-800">
              <video src={`${v.video_url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              <div className="absolute bottom-1 left-1 text- text-white bg-black/50 px-1 rounded">♥ {v.likes_count || 0}</div>
            </button>
          ))}
        </div>
      </div>

      {open!== null && videos && (
        <div className="fixed inset-0 z-40 bg-black">
          <Button variant="ghost" size="icon" onClick={() => setOpen(null)} className="absolute left-3 top-3 z-50 text-white">
            <X />
          </Button>
          <div className="h-dvh overflow-y-scroll snap-y snap-mandatory">
            {videos.map((v) => (
              <div key={v.id} className="h-dvh snap-start flex items-center justify-center">
                <video src={v.video_url} className="h-full w-full object-cover" controls loop playsInline />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
