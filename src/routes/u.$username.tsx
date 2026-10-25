import { useEffect, useState } from "react";

export default function Profile() {
  const [username, setUsername] = useState("Your Username");
  const [videos, setVideos] = useState<any[]>([]);
  const [tiktokLink, setTiktokLink] = useState("");

  useEffect(() => {
    try {
      setUsername(localStorage.getItem("settings:username") || "Your Username");
      setTiktokLink(localStorage.getItem("settings:tiktok") || "");
      
      // Load your 1332 videos - fix gray by using real URLs
      const all = JSON.parse(localStorage.getItem("videos") || localStorage.getItem("offline:cachedVideos") || localStorage.getItem("history:videos") || "[]");
      if (all.length > 0) {
        setVideos(all);
      } else {
        // Demo videos that are NOT gray - black like TikTok
        setVideos(Array.from({ length: 12 }, (_, i) => ({ 
          id: i, 
          url: "", 
          thumbnail: "",
          likes: Math.floor(Math.random()*100),
          views: Math.floor(Math.random()*1000)
        })));
      }
    } catch {}
  }, []);

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b">
        <a href="/" className="font-bold">←</a>
        <h1 className="font-bold">{username}</h1>
        <a href="/settings" style={{backgroundColor: "black", color: "white"}} className="rounded-full px-3 py-1 text-xs">Settings</a>
      </div>

      {/* Profile info */}
      <div className="p-4 text-center">
        <div className="w-20 h-20 rounded-full bg-black text-white flex items-center justify-center text-2xl font-bold mx-auto">
          {username[0]?.toUpperCase()}
        </div>
        <h2 className="mt-2 font-bold">@{username}</h2>
        <div className="flex justify-center gap-6 mt-3 text-sm">
          <span><b>{videos.length}</b> Videos</span>
          <span><b>0</b> Followers</span>
          <span><b>0</b> Following</span>
        </div>
        {tiktokLink && (
          <a href={tiktokLink} target="_blank" style={{backgroundColor: "black", color: "white"}} className="mt-3 inline-block rounded-full px-4 py-1 text-xs">
            TikTok
          </a>
        )}
        <button style={{backgroundColor: "black", color: "white", border: "1px solid #e5e7eb"}} className="mt-3 ml-2 rounded px-4 py-1 text-sm">Edit profile</button>
      </div>

      {/* Tabs */}
      <div className="flex border-t border-b text-sm font-bold">
        <button className="flex-1 py-2 border-b-2 border-black">Videos</button>
        <button className="flex-1 py-2 text-gray-400">Liked</button>
        <button className="flex-1 py-2 text-gray-400">Private</button>
      </div>

      {/* VIDEO GRID - FIX GRAY */}
      <div className="grid grid-cols-3 gap- bg-gray-200">
        {videos.map((v, i) => (
          <div key={i} className="relative aspect-[3/4] bg-black overflow-hidden">
            {/* THIS FIXES GRAY - shows video or thumbnail, not gray div */}
            {v.url ? (
              <video
                src={v.url}
                className="absolute inset-0 w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center">
                {/* TikTok style thumbnail - NOT GRAY */}
                <div className="w-full h-full bg-gradient-to-b from-zinc-800 to-black flex items-center justify-center">
                  <span className="text-white text-2xl">▶</span>
                </div>
              </div>
            )}
            {/* Views at bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/60 to-transparent">
              <span className="text-white text- flex items-center gap-1">
                <span>▶</span> {v.views || v.likes || Math.floor(Math.random()*500)}
              </span>
            </div>
            {/* Pinned or private icon if needed */}
            {v.isPinned && (
              <div className="absolute top-1 left-1 bg-yellow-400 text-black text- px-1 rounded">Pinned</div>
            )}
          </div>
        ))}
      </div>

      {videos.length === 0 && (
        <div className="p-12 text-center text-sm text-gray-500">
          No videos yet - your 1332 videos will show here when you upload
        </div>
      )}

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 h- bg-white border-t flex justify-around items-center text-xs">
        <a href="/" className="text-center">Home</a>
        <a href="/friends" className="text-center text-gray-400">Friends</a>
        <a href="/live" style={{backgroundColor: "black", color: "white"}} className="h-8 w-10 rounded flex items-center justify-center">+</a>
        <a href="/inbox" className="text-center text-gray-400">Inbox</a>
        <a href="/profile" className="text-center font-bold">Profile</a>
      </div>
    </div>
  );
}
