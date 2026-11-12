import { useEffect, useMemo, useState } from "react";
import { animationScale, particleCount, type LiveGift } from "@/lib/coins";

/**
 * One gift send, as it should appear on top of the live video.
 *
 * Pure CSS animations (no Lottie, no video, no images) so it costs a few hundred
 * bytes instead of a megabyte and still runs on a 1-bar connection. In low-data
 * mode it drops to a single particle and no glow.
 */
export type GiftAnimationEvent = {
  /** Unique per send so React can key and replay it. */
  id: string;
  gift: LiveGift;
  quantity: number;
  sender: string;
  self?: boolean;
};

const KIND_CLASS: Record<LiveGift["kind"], string> = {
  fly: "gift-fly",
  pop: "gift-pop",
  spin: "gift-spin",
  snow: "gift-snow",
  burst: "gift-burst",
};

const DURATION_MS = 2200;

export function GiftAnimation({
  event,
  lowData = false,
  onDone,
}: {
  event: GiftAnimationEvent;
  lowData?: boolean;
  onDone?: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setLeaving(false);
    const fade = window.setTimeout(() => setLeaving(true), DURATION_MS - 350);
    const done = window.setTimeout(() => onDone?.(event.id), DURATION_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [event.id, onDone]);

  const particles = useMemo(() => {
    const count = particleCount(event.quantity, lowData);
    return Array.from({ length: count }, (_, index) => {
      // Deterministic-ish spread so the particles don't stack on one line.
      const spread = count === 1 ? 50 : 12 + (76 / Math.max(1, count - 1)) * index;
      return {
        key: `${event.id}-${index}`,
        left: `${spread}%`,
        delay: `${index * 90}ms`,
        size: 34 + ((index * 7) % 18),
        drift: `${((index % 3) - 1) * 18}px`,
      };
    });
  }, [event.id, event.quantity, lowData]);

  const scale = animationScale(event.quantity, event.gift.coins);

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-30 overflow-hidden transition-opacity duration-300 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
      aria-hidden="true"
      data-testid="gift-animation"
    >
      {particles.map((particle) => (
        <span
          key={particle.key}
          className={`gift-particle ${KIND_CLASS[event.gift.kind]}`}
          style={{
            left: particle.left,
            fontSize: `${particle.size}px`,
            animationDelay: particle.delay,
            ["--gift-drift" as string]: particle.drift,
            ["--gift-scale" as string]: String(scale),
            ["--gift-color" as string]: event.gift.color,
            filter: lowData ? "none" : `drop-shadow(0 0 12px ${event.gift.color})`,
          }}
        >
          {event.gift.emoji}
        </span>
      ))}

      <div
        className="gift-banner absolute inset-x-4 top-[22%] mx-auto flex max-w-[20rem] items-center gap-3 rounded-2xl border border-white/15 bg-black/60 px-3 py-2 backdrop-blur"
        style={{ ["--gift-color" as string]: event.gift.color }}
      >
        <span
          className="text-2xl"
          style={{ fontSize: `${Math.round(24 * Math.min(scale, 1.6))}px` }}
        >
          {event.gift.emoji}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold text-white/70">
            {event.self ? "You" : event.sender}
          </span>
          <span className="block truncate text-sm font-extrabold text-white">
            sent {event.gift.name}
            {event.quantity > 1 ? ` x${event.quantity}` : ""}
          </span>
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-[#fe2c55] px-2 py-0.5 text-[10px] font-extrabold text-white">
          {event.gift.coins * event.quantity} 🪙
        </span>
      </div>
    </div>
  );
}
