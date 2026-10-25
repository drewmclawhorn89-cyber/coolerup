import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function UsernameProfile() {
  const { username: paramUsername } = useParams();
  const [username, setUsername] = useState(paramUsername || "drewmclawhorn3");
  const [videos, setVideos] = useState<any[]>([]);
  const [tiktokLink, setTiktokLink] = useState("");

  useEffect(() => {
    if (paramUsername) setUsername(paramUsername);
    try {
      // Load this user's videos - not gray
      const allVideos = JSON.parse(localStorage.getItem("videos") || "[]");
      // Filter by username for this profile
      const userVideos = allVideos.filter((v: any) => v.username === (paramUsername || username)) || [];
      
      if (userVideos.length > 0) {
        setVideos(userVideos);
      } else {
        // Demo - black not gray like TikTok
        setVideos(Array.from({ length: 9 }, (_, i) => ({
          id: `${username}-${i}`,
          username: username,
          url: "",
          likes: Math.floor(Math.random()*500),
          views: Math.floor(Math.random()*2000),
        })));
      }

      // Load this user's TikTok link if they set it
      setTiktokLink(localStorage.getItem(`settings:tiktok:${username}`) || localStorage.getItem("settings:tiktok") || "");
    } catch {}
  }, [paramUsername, username]);

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b">
        <a href="/" className="text-xl">←</a>
        <h1 className="font-bold text-">{username}</h1>
      </div>

      {/* Profile header */}
      <div className="p-4">
        <div className="flex gap-4">
          <div className="w-20 h-20 rounded-full bg-black text-white flex items-center justify-center text-2xl font-bold">
            {username[0]?.toUpperCase()}
          </div>
          <div className="flex-1 flex justify-around text-center text-sm">
            <div><div className="font-bold text-">{videos.length}</div><div className="text-gray-500 text-">Following</div></div>
            <div><div className="font-bold text-">{Math.floor(Math.random()*1000)}</div><div className="text-gray-500 text-">Followers</div></div>
            <div><div className="font-bold text-">{videos.reduce((a,b) => a + (b.likes||0), 0)}</div><div className="text-gray-500 text-">Likes</div></div>
          </div>
        </div>

        <h2 className="mt-3 font-bold text-">@{username}</h2>
        <p className="text- text-gray-700 mt-1">Loop creator • 1332 videos • {username}</p>

        {/* TikTok link shows on profile */}
        {tiktokLink && (
          <a href={tiktokLink} target="_blank" style={{backgroundColor: "black", color: "white"}} className="mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold">
            🔗 TikTok
          </a>
        )}

        <div className="flex gap-2 mt-3">
          <button style={{backgroundColor: "#ff2d55", color: "white"}} className="flex-1 rounded py-1.5 text-sm font-bold">Follow</button>
          <button style={{backgroundColor: "#f1f1f2", color: "black"}} className="flex-1 rounded py-1.5 text-sm font-bold">Message</button>
          <button style={{backgroundColor: "#f1f1f2"}} className="rounded px-3 py-1.5">▼</button>
        </div>

        <p className="text- mt-3">🔗 {tiktokLink || "Add TikTok link in Settings"}</p>
      </div>

      {/* Tabs */}
      <div className="flex border-t border-b text- font-bold">
        <button className="flex-1 py-3 border-b-2 border-black flex justify-center">⊞</button>
        <button className="flex-1 py-3 text-gray-400 flex justify-center">♡</button>
        <button className="flex-1 py-3 text-gray-400 flex justify-center">🔒</button>
      </div>

      {/* VIDEOS GRID - NOT GRAY - BLACK LIKE TIKTOK */}
      <div className="grid grid-cols-3 gap- bg-white">
        {videos.map((v, i) => (
          <div key={i} className="relative aspect-[3/4] bg-black overflow-hidden">
            {/* FIX GRAY - use black background */}
            <div className="absolute inset-0 w-full h-full bg-black">
              {v.url ? (
                <video
                  src={v.url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-b from-zinc-800 to-black flex items-center justify-center">
                  <span className="text-white/80 text-3xl">▶</span>
                </div>
              )}
            </div>
            {/* Views count like TikTok */}
            <div className="absolute bottom-1 left-1 flex items-center gap-1 text-white text- font-bold">
              <span>▶</span> {v.views || v.likes || Math.floor(Math.random()*800)}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 h- bg-white border-t flex justify-around items-center text-">
        <a href="/" className="text-center">Home</a>
        <a href="/explore" className="text-center text-gray-400">Explore</a>
        <a href="/live" className="text-center"><div style={{backgroundColor:"#ff2d55", color:"white", width:"32px", height:"24px", borderRadius:"6px", display:"flex", alignItems:"center", justifyContent:"center"}}>+</div></a>
        <a href="/inbox" className="text-center text-gray-400">Inbox</a>
        <a href="/profile" className="text-center text-gray-400">Profile</a>
      </div>
    </div>
  );
}
