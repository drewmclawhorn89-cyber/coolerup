import type { AnimalFilter } from "@/lib/animals";

/** Live preview of animal stickers; sizes scale with the container width. */
export function AnimalOverlay({ animal }: { animal: AnimalFilter | null }) {
  if (!animal) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ containerType: "size" }} aria-hidden>
      {animal.parts.map((p, i) => (
        <span
          key={i}
          className="absolute -translate-x-1/2 -translate-y-1/2 leading-none"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, fontSize: `${p.size * 100}cqw` }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
