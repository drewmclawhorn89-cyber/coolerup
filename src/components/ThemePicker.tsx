export function ThemePicker({
  theme,
  changeTheme,
}: {
  theme: string;
  changeTheme: (id: string) => void;
}) {
  const themes = [
    { id: "light", label: "Light", color: "#ffffff" },
    { id: "dark", label: "Dark", color: "#000000" },
    { id: "system", label: "System", color: "#e5e7eb" },
    { id: "blue", label: "Blue", color: "#2563EB" },
    { id: "purple", label: "Purple", color: "#9333EA" },
    { id: "pink", label: "Pink", color: "#EC4899" },
    { id: "green", label: "Green", color: "#16A34A" },
    { id: "red", label: "Red", color: "#DC2626" },
  ];

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="App theme">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => changeTheme(t.id)}
          aria-pressed={theme === t.id}
          className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-white transition ${
            theme === t.id
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "opacity-90 hover:opacity-100"
          }`}
        >
          <span
            aria-hidden="true"
            className="size-4 rounded-full border border-white/30"
            style={{ backgroundColor: t.color }}
          />
          {t.label}
        </button>
      ))}
    </div>
  );
}
