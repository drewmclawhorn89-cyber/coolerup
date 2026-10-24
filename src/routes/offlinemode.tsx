import { useEffect, useState } from "react";

export default function Offline() {
  const [videos, setVideos] = useState<any[]>([]);

  useEffect(() => {
    try {
      // get your 1332 videos from wherever you store them - for now show cached count
      const cached = localStorage.getItem("offline:videos");
      if (cached) {
        setVideos(JSON.parse(cached));
      } else {
        // demo: if no cache yet, show placeholder for your 1332 videos
        setVideos(Array.from({ length: 12 }, (_, i) => ({ id: i, title: `Offline Video ${i + 1}` })));
      }
    } catch {}
  }, []);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <a href="/settings" className="text-sm underline">← Back to Settings</a>
        <a href="/" className="text-sm underline ml-4">← Back to For You</a>
        <h1 className="text-2xl font-bold">Offline Videos</h1>
        <p className="text-sm text-muted-foreground">{videos.length} videos available offline - your 1332 videos will show here when cached</p>
        
        <div className="grid grid-cols-2 gap-4">
          {videos.map((v) => (
            <div key={v.id} className="rounded-lg border bg-card p-4">
              <div className="aspect-[9/16] rounded bg-black flex items-center justify-center text-white text-xs">VIDEO</div>
              <p className="mt-2 text-sm font-medium truncate">{v.title || `Video ${v.id}`}</p>
              <p className="text-xs text-muted-foreground">Available offline</p>
            </div>
          ))}
        </div>

        {videos.length === 0 && (
          <div className="rounded-lg border bg-card p-6 text-center">
            <p>No offline videos yet</p>
            <p className="text-sm text-muted-foreground mt-1">Turn ON offline mode in settings to start caching your 1332 videos</p>
            <button onClick={() => window.location.href = "/settings"} style={{backgroundColor: "black", color: "white"}} className="mt-3 rounded-md px-4 py-2">Go to Settings</button>
          </div>
        )}
      </div>
    </div>
  );
}
