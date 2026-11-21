import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ExternalLink,
  Facebook,
  Film,
  Home,
  Loader2,
  Monitor,
  PlaySquare,
  RotateCw,
  Search,
  Smartphone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { FacebookPlayer } from "@/components/FacebookPlayer";
import { useAuth } from "@/hooks/useAuth";
import { proxyUrlFor, targetFromProxyUrl } from "@/lib/browserProxy";
import {
  FACEBOOK_HOME_URL,
  FACEBOOK_REELS_URL,
  FACEBOOK_WATCH_URL,
  formatFacebookDisplayUrl,
  isMobileFacebookUrl,
  needsFacebookResolve,
  normalizeFacebookVideoUrl,
  resolveFacebookBarInput,
  setFacebookHostMode,
} from "@/lib/facebook";
import {
  createWatchDurationTracker,
  detectExternalVideoSource,
  recordWatchHistory,
} from "@/lib/watchHistory";

const SAVED_LINKS_KEY = "coolerup:facebook-videos";

function readSavedLinks(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_LINKS_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (l): l is string => typeof l === "string" && !!normalizeFacebookVideoUrl(l),
    );
  } catch {
    return [];
  }
}

/**
 * Runs Facebook directly inside the Coolerup Facebook tab using Coolerup's
 * reverse proxy, while keeping quick Watch/Reels switches and saved link
 * playback accessible inside the same panel.
 */
export function FacebookPanel() {
  const auth = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);

  const [nav, setNav] = useState<{ entries: string[]; index: number }>({
    entries: [FACEBOOK_HOME_URL],
    index: 0,
  });
  const [liveAddress, setLiveAddress] = useState(FACEBOOK_HOME_URL);
  const [barInput, setBarInput] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"app" | "saved">("app");

  const [savedLinks, setSavedLinks] = useState<string[]>(() =>
    typeof window !== "undefined" ? readSavedLinks() : [],
  );
  const [clipInput, setClipInput] = useState("");
  const [addingClip, setAddingClip] = useState(false);

  const currentFrameTarget = nav.entries[nav.index] ?? FACEBOOK_HOME_URL;
  const mobileMode = isMobileFacebookUrl(liveAddress);
  const canBack = nav.index > 0;
  const canForward = nav.index < nav.entries.length - 1;

  const navigateInApp = useCallback(
    (nextUrl: string) => {
      setMode("app");
      setLoading(true);
      setLiveAddress(nextUrl);
      setNav((prev) => {
        const sliced = prev.entries.slice(0, prev.index + 1);
        if (sliced[sliced.length - 1] === nextUrl) {
          return prev;
        }
        const entries = [...sliced, nextUrl];
        return { entries, index: entries.length - 1 };
      });
      if (currentFrameTarget === nextUrl) {
        setReloadKey((k) => k + 1);
      }
    },
    [currentFrameTarget],
  );

  const goBack = () => {
    if (!canBack) return;
    const nextIdx = nav.index - 1;
    const nextUrl = nav.entries[nextIdx] ?? FACEBOOK_HOME_URL;
    setLoading(true);
    setNav((prev) => ({ ...prev, index: nextIdx }));
    setLiveAddress(nextUrl);
  };

  const goForward = () => {
    if (!canForward) return;
    const nextIdx = nav.index + 1;
    const nextUrl = nav.entries[nextIdx] ?? FACEBOOK_HOME_URL;
    setLoading(true);
    setNav((prev) => ({ ...prev, index: nextIdx }));
    setLiveAddress(nextUrl);
  };

  const reloadFrame = () => {
    setLoading(true);
    const frame = frameRef.current;
    if (frame) {
      frame.src = proxyUrlFor(liveAddress || currentFrameTarget);
    } else {
      setReloadKey((k) => k + 1);
    }
  };

  // Follow SPA pushState/replaceState navigations reported by PROXY_SHIM inside Facebook.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { coolerupAddress?: unknown } | null;
      if (data && typeof data.coolerupAddress === "string") {
        setLiveAddress(data.coolerupAddress);
        setLoading(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Never let a slow subresource keep the loading screen over an already-painted page.
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setLoading(false), 5000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  // Automatically record Facebook videos/reels watched for >3 seconds when signed in.
  useEffect(() => {
    if (mode !== "app" || !auth.user?.id || !liveAddress) return;
    const detected = detectExternalVideoSource(liveAddress);
    if (!detected) return;
    const uid = auth.user.id;
    const tracker = createWatchDurationTracker({
      onTrigger: () => {
        void recordWatchHistory(uid, detected);
      },
    });
    tracker.start();
    return () => tracker.dispose();
  }, [mode, auth.user?.id, liveAddress]);

  const onFrameLoad = () => {
    setLoading(false);
    try {
      const href = frameRef.current?.contentWindow?.location.href;
      const target = href ? targetFromProxyUrl(href) : null;
      if (target) setLiveAddress(target);
    } catch {
      /* ignore cross-origin access */
    }
  };

  const onBarSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let resolved = resolveFacebookBarInput(barInput, mobileMode);
    if (!resolved) return;
    if (needsFacebookResolve(resolved)) {
      try {
        const res = await fetch(`/api/facebook/resolve?url=${encodeURIComponent(resolved)}`);
        const data = (await res.json()) as { url?: string };
        if (data.url) resolved = setFacebookHostMode(data.url, mobileMode);
      } catch {
        /* keep resolved input */
      }
    }
    setBarInput("");
    navigateInApp(resolved);
  };

  const persistSaved = (next: string[]) => {
    setSavedLinks(next);
    try {
      localStorage.setItem(SAVED_LINKS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const onAddSavedClip = async (e: FormEvent) => {
    e.preventDefault();
    let url = normalizeFacebookVideoUrl(clipInput);
    if (!url) {
      toast.error("Paste a link from Facebook (video, reel, share or fb.watch)");
      return;
    }
    if (needsFacebookResolve(url)) {
      setAddingClip(true);
      try {
        const res = await fetch(`/api/facebook/resolve?url=${encodeURIComponent(url)}`);
        const data = (await res.json()) as { url?: string };
        if (data.url) url = data.url;
      } catch {
        /* keep pasted url */
      } finally {
        setAddingClip(false);
      }
    }
    persistSaved([url, ...savedLinks.filter((l) => l !== url)]);
    setClipInput("");
  };

  const toggleHostMode = () => {
    const nextUrl = setFacebookHostMode(liveAddress || currentFrameTarget, !mobileMode);
    navigateInApp(nextUrl);
  };

  const iconBtn =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-35";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-black text-white">
      {/* Facebook in-app bar */}
      <div className="shrink-0 border-b border-white/10 bg-black px-3 py-2">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1877F2] px-2.5 py-1 text-xs font-bold text-white">
              <Facebook className="size-3.5" />
              Facebook
            </span>
            <button
              type="button"
              onClick={() => navigateInApp(setFacebookHostMode(FACEBOOK_HOME_URL, mobileMode))}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                mode === "app" && !liveAddress.includes("/watch") && !liveAddress.includes("/reel")
                  ? "bg-white text-black"
                  : "bg-white/10 text-white/85 hover:bg-white/20"
              }`}
            >
              <Home className="size-3" /> Feed
            </button>
            <button
              type="button"
              onClick={() => navigateInApp(setFacebookHostMode(FACEBOOK_WATCH_URL, mobileMode))}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                mode === "app" && liveAddress.includes("/watch")
                  ? "bg-white text-black"
                  : "bg-white/10 text-white/85 hover:bg-white/20"
              }`}
            >
              <PlaySquare className="size-3" /> Watch
            </button>
            <button
              type="button"
              onClick={() => navigateInApp(setFacebookHostMode(FACEBOOK_REELS_URL, mobileMode))}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                mode === "app" && liveAddress.includes("/reel")
                  ? "bg-white text-black"
                  : "bg-white/10 text-white/85 hover:bg-white/20"
              }`}
            >
              <Film className="size-3" /> Reels
            </button>
            <button
              type="button"
              onClick={() => setMode((m) => (m === "saved" ? "app" : "saved"))}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                mode === "saved"
                  ? "bg-[#FE2C55] text-white"
                  : "bg-white/10 text-white/85 hover:bg-white/20"
              }`}
            >
              <Bookmark className="size-3" /> Links
              {savedLinks.length > 0 ? ` (${savedLinks.length})` : ""}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleHostMode}
              title={mobileMode ? "Switch to Desktop Facebook" : "Switch to Mobile Facebook"}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/20"
            >
              {mobileMode ? <Smartphone className="size-3" /> : <Monitor className="size-3" />}
              {mobileMode ? "Mobile" : "Desktop"}
            </button>
            <a
              href={liveAddress}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Facebook outside Coolerup"
              title="Open outside Coolerup"
              className={iconBtn}
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>

        {mode === "app" && (
          <div className="mx-auto mt-2 flex max-w-3xl items-center gap-1.5">
            <button
              type="button"
              onClick={goBack}
              disabled={!canBack}
              aria-label="Back"
              className={iconBtn}
            >
              <ArrowLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={goForward}
              disabled={!canForward}
              aria-label="Forward"
              className={iconBtn}
            >
              <ArrowRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={reloadFrame}
              aria-label="Reload Facebook"
              className={iconBtn}
            >
              <RotateCw className="size-3.5" />
            </button>
            <form
              onSubmit={onBarSubmit}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1"
            >
              <Search className="size-3.5 shrink-0 text-white/50" />
              <input
                value={barInput}
                onChange={(e) => setBarInput(e.target.value)}
                placeholder={formatFacebookDisplayUrl(liveAddress)}
                aria-label="Search Facebook or paste link"
                className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/55"
              />
              {barInput.trim() && (
                <button
                  type="submit"
                  className="shrink-0 rounded-full bg-[#1877F2] px-2.5 py-0.5 text-[11px] font-bold text-white"
                >
                  Go
                </button>
              )}
            </form>
          </div>
        )}
      </div>

      {/* Main viewport */}
      {mode === "app" ? (
        <div className="relative min-h-0 flex-1 bg-white">
          {loading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/90 text-white">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1877F2]">
                <Facebook className="size-6 text-white" />
              </div>
              <Loader2 className="size-5 animate-spin text-[#6ea8ff]" />
              <p className="text-xs font-semibold text-white/80">Opening Facebook in Coolerup…</p>
            </div>
          )}
          <iframe
            ref={frameRef}
            key={`${currentFrameTarget}-${reloadKey}`}
            src={proxyUrlFor(currentFrameTarget)}
            title="Facebook inside Coolerup"
            className="h-full w-full border-0 bg-white"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-presentation allow-downloads"
            allow="clipboard-write; encrypted-media; picture-in-picture; fullscreen; autoplay"
            allowFullScreen
            onLoad={onFrameLoad}
          />
        </div>
      ) : (
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3 text-white">
          <form onSubmit={onAddSavedClip} className="mx-auto flex max-w-xl gap-2">
            <input
              value={clipInput}
              onChange={(e) => setClipInput(e.target.value)}
              placeholder="Paste Facebook video link"
              className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={addingClip}
              className="rounded-full bg-[#1877f2] px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {addingClip ? "Adding…" : "Add"}
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-xl text-center text-[11px] text-white/60">
            Plays from Facebook&apos;s own player. Videos are never downloaded or re-uploaded.
          </p>
          <div className="mx-auto mt-4 flex max-w-xl flex-col gap-5">
            {savedLinks.length === 0 ? (
              <p className="py-12 text-center text-sm text-white/50">
                No saved Facebook links yet. Paste a Facebook video, reel, or fb.watch link above.
              </p>
            ) : (
              savedLinks.map((link) => (
                <div key={link}>
                  <div className="mb-2 flex items-center gap-2 rounded-lg bg-[#1877f2] px-3 py-2 text-sm font-semibold">
                    <Facebook className="size-4" /> Playing from Facebook
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto"
                      aria-label="Open on Facebook"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => persistSaved(savedLinks.filter((l) => l !== link))}
                      aria-label="Remove"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <FacebookPlayer url={link} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
