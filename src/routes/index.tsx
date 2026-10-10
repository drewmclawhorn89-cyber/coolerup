import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Plus, LogOut, Search, Heart, MessageCircle, Share2, Music2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { VideoCard } from "@/components/VideoCard";
import { UploadDialog } from "@/components/UploadDialog";
import { Comments } from "@/components/Comments";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const auth = useAuth() as any;
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<any>(null);
  const [showComments, setShowComments] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
     .from("videos")
     .select("*, profiles(username, avatar_url)")
     .order("created_at", { ascending: false });
    if (data) setVideos(data);
    setLoading(false);
    setReady(true);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <aside className="hidden w- shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">C</div>
          <span className="font-display text-xl font-bold">coolerup</span>
        </div>

        <nav className="flex flex-col gap-2 mb-4">
          <Link to="/" className="flex items-center gap-3 rounded-xl bg-secondary p-3 font-bold">
            <Search className="h-5 w-5" /> For You
          </Link>
        </nav>

        <button
          onClick={() => (auth.user? setUploading(true) : auth.signIn())}
          className="flex items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground"
        >
          <Plus className="h-5 w-5" /> Upload video
        </button>

        {ready && auth.user? (
          <div className="mt-auto flex items-center gap-3 rounded-xl bg-secondary p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary uppercase text-primary-foreground">
              {auth.name?.[0]}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-muted-foreground text-xs">Signed in as</p>
              <p className="truncate font-bold">{auth.name}</p>
            </div>
            <button onClick={auth.signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-auto flex flex-col gap-2">
            <button
              onClick={auth.signIn}
              className="flex items-center justify-center gap-2 rounded-xl border bg-white p-3 font-bold text-black"
            >
              Sign in with Google
            </button>

            <button
              onClick={async () => {
                const phone = prompt("Phone with country code, ex: +19195551234");
                if (!phone) return;
                const { error } = await supabase.auth.signInWithOtp({ phone });
                if (error) { alert(error.message); return; }
                const code = prompt("Enter 6-digit code sent to " + phone);
                if (!code) return;
                const { error: e2 } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
                if (e2) alert(e2.message);
                else location.reload();
              }}
              className="flex items-center justify-center gap-2 rounded-xl border bg-secondary p-3 font-bold"
            >
              Sign in with Phone
            </button>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-sidebar px-4 py-2 md:hidden">
          <h1 className="font-display text-2xl">loop<span className="text-primary">.</span></h1>
          <button
            onClick={() => (auth.user? setUploading(true) : auth.signIn())}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        <div ref={containerRef} className="flex-1 snap-y snap-mandatory overflow-y-scroll bg-black">
          {loading? (
            <div className="flex h-full items-center justify-center text-white">Loading...</div>
          ) : (
            videos.map((video) => (
              <div key={video.id} className="relative flex h-full w-full snap-start items-center justify-center">
                <VideoCard video={video} isActive={selectedVideo?.id === video.id} onComment={() => { setSelectedVideo(video); setShowComments(true); }} />
              </div>
            ))
          )}
        </div>
      </main>

      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onUploaded={() => { setUploading(false); load(); }}
        />
      )}

      {showComments && selectedVideo && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
          <div className="flex w-full max-w- flex-col bg-background">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="font-bold">{selectedVideo.comments_count || 0} comments</h2>
              <button onClick={() => setShowComments(false)} className="rounded-full bg-secondary p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <Comments videoId={selectedVideo.id} />
          </div>
        </div>
      )}
    </div>
  );
}
