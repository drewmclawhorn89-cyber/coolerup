import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { buildFacebookEmbedUrl } from "@/lib/facebook";
import { loadFacebookSdk } from "@/lib/facebookSdk";

/**
 * The real Facebook player (official SDK `fb-video`). If the SDK is blocked
 * (ad blocker, offline) it falls back to Facebook's plugin iframe.
 */
export function FacebookPlayer({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setState("loading");
    const width = Math.min(Math.max(Math.round(host.clientWidth) || 500, 220), 500);
    host.innerHTML = "";
    const el = document.createElement("div");
    el.className = "fb-video";
    el.setAttribute("data-href", url);
    el.setAttribute("data-width", String(width));
    el.setAttribute("data-show-text", "false");
    el.setAttribute("data-allowfullscreen", "true");
    el.setAttribute("data-autoplay", "false");
    host.appendChild(el);

    loadFacebookSdk()
      .then((FB) => {
        if (cancelled) return;
        FB.XFBML.parse(host);
        setState("ready");
        // If Facebook rendered nothing after a while (blocked), show the iframe.
        window.setTimeout(() => {
          if (!cancelled && !host.querySelector("iframe")) setState("fallback");
        }, 6000);
      })
      .catch(() => {
        if (!cancelled) setState("fallback");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state === "fallback") {
    return (
      <iframe
        title="Facebook video"
        src={buildFacebookEmbedUrl(url)}
        className="aspect-video w-full rounded-lg border-0 bg-black"
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
      />
    );
  }
  return (
    <div className="relative flex min-h-[200px] w-full justify-center overflow-hidden rounded-lg bg-black">
      {state === "loading" && <Loader2 className="absolute top-1/2 size-6 -translate-y-1/2 animate-spin text-white/60" />}
      <div ref={hostRef} className="w-full [&_.fb-video]:mx-auto" />
    </div>
  );
}
