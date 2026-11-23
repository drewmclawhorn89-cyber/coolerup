/**
 * Gray-box skeleton placeholders shown while routes, feeds, grids, and panels
 * load so users never stare at a blank screen on slow connections.
 */

export function FeedSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading feed"
      className="relative flex h-full w-full flex-col justify-between bg-black p-4 pb-24 pt-20 text-white"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
        <div className="h-full max-h-[70dvh] w-full animate-pulse rounded-2xl bg-zinc-800/80" />
      </div>
      <div className="mx-auto mt-4 flex w-full max-w-md items-end justify-between gap-4">
        <div className="flex-1 space-y-2.5">
          <div className="h-4 w-32 animate-pulse rounded bg-zinc-800/90" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-zinc-800/80" />
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-zinc-800/70" />
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-zinc-800/90" />
          <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-800/80" />
          <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-800/80" />
        </div>
      </div>
    </div>
  );
}

export function VideoGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading videos" className="grid grid-cols-3 gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="aspect-[9/16] animate-pulse rounded-sm bg-zinc-800/80" />
      ))}
    </div>
  );
}

export function FullVideoGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading videos"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2.5 rounded-xl border border-white/10 bg-zinc-950 p-2.5">
          <div className="aspect-video w-full animate-pulse rounded-lg bg-zinc-800/80" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-800/90" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800/70" />
        </div>
      ))}
    </div>
  );
}

export function ListRowSkeleton({
  count = 4,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-label="Loading items" className={`space-y-3 py-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-zinc-800/90" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-36 animate-pulse rounded bg-zinc-800/90" />
            <div className="h-3 w-56 max-w-full animate-pulse rounded bg-zinc-800/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboxSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading notifications" className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-900/80 p-3"
        >
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-zinc-800" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-44 max-w-full animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-24 animate-pulse rounded bg-zinc-800/70" />
          </div>
          <div className="h-12 w-9 shrink-0 animate-pulse rounded-md bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

export function SearchSkeleton() {
  return (
    <div role="status" aria-label="Searching" className="space-y-4">
      <ListRowSkeleton count={3} />
      <VideoGridSkeleton count={6} />
    </div>
  );
}

export function GifGridSkeleton({
  count = 6,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-label="Loading GIFs" className={`grid grid-cols-2 gap-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-28 w-full animate-pulse rounded-lg bg-zinc-800/80" />
      ))}
    </div>
  );
}

export function PanelSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading panel"
      className="mx-auto w-full max-w-xl space-y-4 bg-black p-4 text-white"
    >
      <div className="h-7 w-40 animate-pulse rounded bg-zinc-800/90" />
      <div className="h-28 w-full animate-pulse rounded-2xl bg-zinc-800/80" />
      <ListRowSkeleton count={4} />
    </div>
  );
}

export function RoutePendingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="min-h-dvh w-full bg-black px-4 pb-20 pt-6 text-white"
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800/90" />
          <div className="h-8 w-20 animate-pulse rounded-full bg-zinc-800/80" />
        </div>
        <div className="h-36 w-full animate-pulse rounded-2xl bg-zinc-800/80" />
        <VideoGridSkeleton count={6} />
      </div>
    </div>
  );
}
