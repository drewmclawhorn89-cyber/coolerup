import type { VisiblePresence } from "@/lib/onlineStatus";

export function OnlineDot({
  visible,
  size = "md",
  className = "",
}: {
  visible: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (!visible) return null;
  const sizeClass =
    size === "sm" ? "h-2.5 w-2.5 border" : size === "lg" ? "h-4 w-4 border-2" : "h-3 w-3 border-2";
  return (
    <span
      data-testid="online-dot"
      aria-label="Online now"
      className={`inline-block shrink-0 rounded-full border-black bg-[#25D366] ${sizeClass} ${className}`}
    />
  );
}

export function OnlineStatusSubtitle({
  status,
  className = "",
}: {
  status: VisiblePresence;
  className?: string;
}) {
  if (!status.visible) return null;
  if (status.isOnline) {
    return (
      <span
        data-testid="online-status-label"
        className={`inline-flex items-center gap-1.5 text-xs font-medium text-white/80 ${className}`}
      >
        <span className="h-2 w-2 rounded-full bg-[#25D366]" aria-hidden="true" />
        Active now
      </span>
    );
  }
  if (!status.statusText) return null;
  return (
    <span data-testid="last-active-text" className={`text-xs text-white/60 ${className}`}>
      {status.statusText}
    </span>
  );
}
