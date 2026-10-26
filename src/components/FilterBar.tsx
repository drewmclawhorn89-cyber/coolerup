import { CAMERA_FILTERS } from "@/lib/filters";
import { ANIMAL_FILTERS } from "@/lib/animals";

export function FilterBar({
  value,
  onChange,
  disabled,
  animal = "",
  onAnimalChange,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  animal?: string;
  onAnimalChange?: (id: string) => void;
}) {
  return (
    <>
      {onAnimalChange && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2" role="radiogroup" aria-label="Animal filters">
          {[{ id: "", name: "No animal", icon: "🚫" }, ...ANIMAL_FILTERS].map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={animal === a.id}
              aria-label={a.name}
              disabled={disabled}
              onClick={() => onAnimalChange(a.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-base transition disabled:opacity-50 ${animal === a.id ? "bg-primary" : "bg-white/15"}`}
            >
              {a.icon}
            </button>
          ))}
        </div>
      )}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-3" role="radiogroup" aria-label="Filters">
        {CAMERA_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={value === f.id}
            disabled={disabled}
            onClick={() => onChange(f.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${value === f.id ? "bg-primary text-primary-foreground" : "bg-white/15 text-white"}`}
          >
            {f.name}
          </button>
        ))}
      </div>
    </>
  );
}
