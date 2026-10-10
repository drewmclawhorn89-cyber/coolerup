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
  const auth = useAuth();
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

  const handlePhoneSignIn = async () => {
    const phone = window.prompt("Enter phone with country code (ex: +19195551234)");
    if (!phone) return;
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      alert(error.message);
      return;
    }
    const code = window.prompt(`Enter the 6-digit code sent to ${phone}`);
    if (!code) return;
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });
    if (verifyError) alert(verifyError.message);
    else window.location.reload();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <aside className="hidden w- shrink-0 flex-col border-r bg-sidebar p-4 md:flex">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
            C
          </div>
          <span className="font-display text-xl font-bold">coolerup</span>
        </div>

        <nav className="flex flex-col gap-2">
          <Link to="/" className="flex items-center gap-3 rounded-xl bg-secondary p-3 font-bold">
            <Search className="h-5 w-5" /> For You
          </Link>
          <button className="flex items-center gap-3 rounded-xl p-3 text-muted-foreground">
            <Heart className="h-5 w-5" /> Following
          </button>
          <button className="flex items-center gap-3 rounded-xl p-3 text-muted-foreground">
            <MessageCircle className="h-5 w-5" /> Messages
          </button>
        </nav>

        <button
          onClick={() => (auth.user? setUploading(true) : auth.signIn())}
          className="flex items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground shadow-[0_10px_30px_-10px_hsl(var(--primary))]"
        >
          <Plus className="h-5 w-5" /> Upload video
        </button>

        {ready && auth.user? (
          <div className="mt-auto flex items-center gap-3 rounded-xl bg-secondary p-3">
            {auth.avatar? (
              <img src={auth.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-display uppercase text-primary-foreground">
                {auth.name?.[0]}
              </div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-muted-foreground">Signed in as</p>
              <p className="truncate font-bold">{auth.name}</p>
            </div>
            <button onClick={auth.signOut} aria-label="Sign out" className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-auto flex flex-col gap-2">
            <button
              onClick={auth.signIn}
              className="flex items-center justify-center gap-2 rounded-xl border bg-white p-3 font-bold text-black transition hover:bg-zinc-100"
            >
              Sign in with Google
            </button>
            <button
              onClick={handlePhoneSignIn}
              className="flex items-center justify-center gap-2 rounded-xl border bg-secondary p-3 font-bold transition hover:bg-accent"
            >
              Sign in with Phone
            </button>
          </div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mobile-topbar grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-sidebar px-4 md:hidden">
          <h1 className="min-w-0 font-display text-2xl">loop<span className="text-primary">.</span></h1>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => (auth.user? setUploading(true) : auth.signIn())}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Plus className="h-5 w-5" />
            </button>
            {ready &&!auth.user && (
              <button onClick={auth.signIn} className="rounded-full bg-secondary px-3 py-1.5 text-sm font-bold">
                Sign in
              </button>
            )}
            {ready && auth.user && (
              <button onClick={auth.signOut} className="h-9 w-9 overflow-hidden rounded-full bg-secondary">
                {auth.avatar? (
                  <img src={auth.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary font-bold uppercase text-primary-foreground">
                    {auth.name?.[0]}
                  </div>
                )}
              </button>
            )}
          </div>
        </div>

        <div ref={containerRef} className="flex-1 snap-y snap-mandatory overflow-y-scroll bg-black">
          {loading? (
            <div className="flex h-full items-center justify-center text-white">Loading...</div>
          ) : videos.length === 0? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-white">
              <p className="text-xl font-bold">No videos yet</p>
              <button onClick={() => (auth.user? setUploading(true) : auth.signIn())} className="rounded-full bg-white px-6 py-3 font-bold text-black">
                Upload first video
              </button>
            </div>
          ) : (
            videos.map((video) => (
              <div key={video.id} className="relative flex h-full w-full snap-start items-center justify-center">
                <VideoCard
                  video={video}
                  isActive={selectedVideo?.id === video.id}
                  onComment={() => {
                    setSelectedVideo(video);
                    setShowComments(true);
                  }}
                />
                <div className="absolute bottom-20 right-4 flex flex-col gap-6 md:bottom-10 md:right-10">
                  <button className="flex flex-col items-center gap-1 text-white">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                      <Heart className="h-7 w-7" />
                    </div>
                    <span className="text-xs font-bold">12.3k</span>
                  </button>
                  <button
                    onClick={() => {
                      setSelectedVideo(video);
                      setShowComments(true);
                    }}
                    className="flex flex-col items-center gap-1 text-white"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                      <MessageCircle className="h-7 w-7" />
                    </div>
                    <span className="text-xs font-bold">342</span>
                  </button>
                  <button className="flex flex-col items-center gap-1 text-white">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                      <Share2 className="h-7 w-7" />
                    </div>
                    <span className="text-xs font-bold">Share</span>
                  </button>
                  <div className="flex flex-col items-center gap-1 text-white">
                    <div className="flex h-12 w-12 animate-spin items-center justify-center rounded-full bg-white/10 [animation-duration:3s]">
                      <Music2 className="h-7 w-7" />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            load();
          }}
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
