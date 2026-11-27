import { Check } from "lucide-react";
import { useEffect } from "react";
import { QUALITY_OPTIONS, resolveRendition, type QualityId } from "@/lib/videoQuality";
import type { EffectiveType } from "@/lib/network";

/**
 * TikTok-style quality picker.
 *
 * Opens from the Quality tile in the Share sheet (or a long press on the video).
 * White text on a translucent black panel, rounded corners, a checkmark on the
 * active row, and a short hint under each label.
 */
export function QualitySelector({
  open,
  quality,
  effectiveType = "unknown",
  onSelect,
  onClose,
}: {
  open: boolean;
  quality: QualityId;
  /** Used to spell out what Auto is doing right now. */
  effectiveType?: EffectiveType;
  onSelect: (quality: QualityId) => void;
  onClose: () => void;
}) {
  // Escape closes, like every other sheet in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const autoPicks = resolveRendition("auto", effectiveType);

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Video quality"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-20 right-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-black/85 p-2 text-white shadow-2xl backdrop-blur"
      >
        <p className="px-2 pb-1 pt-0.5 text-[11px] font-bold uppercase tracking-widest text-white/50">
          Quality
        </p>
        <div className="flex flex-col">
          {QUALITY_OPTIONS.map((option) => {
            const active = quality === option.id;
            const hint = option.id === "auto" ? `Auto \u00b7 playing ${autoPicks}` : option.hint;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onSelect(option.id);
                  onClose();
                }}
                aria-pressed={active}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                  active ? "bg-white/15" : "hover:bg-white/10"
                }`}
              >
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-semibold leading-tight ${
                      active ? "text-white" : "text-gray-300"
                    }`}
                  >
                    {option.label}
                  </span>
                  {hint && (
                    <span className="block truncate text-[10px] leading-tight text-white/45">
                      {hint}
                    </span>
                  )}
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-[#1ce783]" />}
              </button>
            );
          })}
        </div>
        <p className="px-2 pt-1 text-[10px] leading-tight text-white/35">
          Auto adjusts based on your connection — like TikTok.
        </p>
      </div>
    </div>
  );
}
