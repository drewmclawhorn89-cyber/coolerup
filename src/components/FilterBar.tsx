import { CAMERA_FILTERS } from "@/lib/filters";

export function FilterBar({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return (
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
  );
}
