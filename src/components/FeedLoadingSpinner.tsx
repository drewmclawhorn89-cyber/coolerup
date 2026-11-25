import { Loader2 } from "lucide-react";

/**
 * Small, unobtrusive spinner shown at the bottom of a feed while the next
 * batch of 10 is loading. Keeps the black background / white text look.
 */
export function FeedLoadingSpinner({
  label = "Loading more videos",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={`flex items-center justify-center gap-2 py-4 text-xs text-white/60 ${className}`}
    >
      <Loader2 className="h-4 w-4 animate-spin text-white/80" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
