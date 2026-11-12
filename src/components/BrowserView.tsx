import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Home,
  Plus,
  RotateCw,
  ShieldAlert,
  Star,
  X,
} from "lucide-react";
import { isBlockedUrl, isEmbeddable } from "@/lib/browser";

/** One browser tab: a back/forward stack of URLs plus a label. */
export type BrowserTabState = {
  id: string;
  /** Visited URLs in order. `stack[index]` is the page on screen. */
  stack: string[];
  /** Cursor into `stack`, so back/forward can move without losing the tail. */
  index: number;
  title: string;
};

const controlClass =
  "flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * The browser chrome and the page viewport.
 *
 * The viewport is a sandboxed <iframe>. `allow-downloads` is deliberately
 * omitted, so a page cannot push an APK/EXE onto the device even if it tries —
 * the browser-level blocklist in `lib/browser` is the second line of defence.
 *
 * When a site refuses framing (X-Frame-Options / frame-ancestors) we cannot
 * detect it from the parent, so `isEmbeddable()` predicts it and we show an
 * "Open in Chrome" card instead of a blank rectangle.
 */
export function BrowserView({
  tabs,
  activeTabId,
  currentUrl,
  canGoBack,
  canGoForward,
  saved,
  reloadKey,
  onBack,
  onForward,
  onRefresh,
  onHome,
  onSave,
  onNewTab,
  onSelectTab,
  onCloseTab,
  onOpenExternal,
}: {
  tabs: BrowserTabState[];
  activeTabId: string;
  currentUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  saved: boolean;
  reloadKey: number;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onHome: () => void;
  onSave: () => void;
  onNewTab: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onOpenExternal: (url: string) => void;
}) {
  const blocked = currentUrl ? isBlockedUrl(currentUrl) : false;
  const embeddable = currentUrl ? isEmbeddable(currentUrl) : false;

  return (
    <div className="mx-auto w-full max-w-2xl px-4">
      {/* Controls */}
      <div className="flex items-center gap-1 py-1">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Back"
          className={controlClass}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Forward"
          className={controlClass}
        >
          <ArrowRight className="h-5 w-5" />
        </button>
        <button type="button" onClick={onRefresh} aria-label="Refresh" className={controlClass}>
          <RotateCw className="h-4.5 w-4.5" />
        </button>
        <button type="button" onClick={onHome} aria-label="Home" className={controlClass}>
          <Home className="h-4.5 w-4.5" />
        </button>

        <div className="mx-1 min-w-0 flex-1 truncate rounded-full bg-white/5 px-3 py-1.5 text-xs text-muted-foreground">
          {currentUrl ?? "New tab"}
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={!currentUrl || blocked}
          aria-label={saved ? "Saved" : "Save bookmark"}
          className={`${controlClass} ${saved ? "text-amber-400" : ""}`}
        >
          <Star className={`h-4.5 w-4.5 ${saved ? "fill-current" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => currentUrl && onOpenExternal(currentUrl)}
          disabled={!currentUrl || blocked}
          aria-label="Open in Chrome"
          className={controlClass}
        >
          <ExternalLink className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* Tab strip */}
      <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                isActive
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-white/10 bg-white/5 text-muted-foreground"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className="max-w-[9rem] truncate"
                title={tab.title}
              >
                {tab.title || "New tab"}
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`Close ${tab.title || "tab"}`}
                className="rounded-full p-0.5 hover:bg-white/15"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onNewTab}
          className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> New Tab
        </button>
        <span className="ml-auto shrink-0 pl-2 text-[11px] font-semibold text-muted-foreground">
          {tabs.length} {tabs.length === 1 ? "tab" : "tabs"}
        </span>
      </div>

      {/* Viewport */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
        {!currentUrl ? (
          <EmptyState onNewTab={onNewTab} />
        ) : blocked ? (
          <BlockedState url={currentUrl} />
        ) : !embeddable ? (
          <FrameBlockedState url={currentUrl} onOpenExternal={onOpenExternal} />
        ) : (
          <iframe
            key={`${currentUrl}-${reloadKey}`}
            src={currentUrl}
            title="Coolerup Browser"
            className="h-[70vh] w-full bg-white"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
            allow="clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          />
        )}
      </div>
      <p className="px-1 py-2 text-[11px] text-muted-foreground">
        SafeSearch is on. Downloads are off — only images can be opened outside Coolerup.
      </p>
    </div>
  );
}

function EmptyState({ onNewTab }: { onNewTab: () => void }) {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-3 bg-background text-center">
      <span className="text-4xl" aria-hidden>
        🌐
      </span>
      <p className="text-sm font-semibold">Nothing open</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Search above, or tap a site tab to start browsing.
      </p>
      <button
        type="button"
        onClick={onNewTab}
        className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
      >
        Open a new tab
      </button>
    </div>
  );
}

function BlockedState({ url }: { url: string }) {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <ShieldAlert className="h-9 w-9 text-destructive" />
      <p className="text-sm font-semibold">This site is blocked</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Coolerup blocks adult content and dangerous downloads. That includes{" "}
        <span className="break-all font-mono">{url}</span>.
      </p>
    </div>
  );
}

function FrameBlockedState({
  url,
  onOpenExternal,
}: {
  url: string;
  onOpenExternal: (url: string) => void;
}) {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <span className="text-4xl" aria-hidden>
        🔒
      </span>
      <p className="text-sm font-semibold">This site won&apos;t load inside Coolerup</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {url} blocks being shown in another app. You can still open it in Chrome.
      </p>
      <button
        type="button"
        onClick={() => onOpenExternal(url)}
        className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
      >
        <ExternalLink className="h-3.5 w-3.5" /> Open in Chrome
      </button>
    </div>
  );
}
