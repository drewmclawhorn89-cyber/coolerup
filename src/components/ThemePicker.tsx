export function ThemePicker({
  theme,
  changeTheme,
}: {
  theme: string;
  changeTheme: (id: string) => void;
}) {
  const themes = [
    { id: "dark", label: "Black", color: "#fe2c55", text: "#ffffff" },
    { id: "white", label: "White", color: "#ffffff", text: "#000000" },
    { id: "system", label: "System", color: "#e5e7eb", text: "#000000" },
    { id: "blue", label: "Blue", color: "#2563EB", text: "#ffffff" },
    { id: "red", label: "Red", color: "#DC2626", text: "#ffffff" },
    { id: "pink", label: "Pink", color: "#EC4899", text: "#ffffff" },
    { id: "green", label: "Green", color: "#16A34A", text: "#ffffff" },
    { id: "purple", label: "Purple", color: "#9333EA", text: "#ffffff" },
    { id: "orange", label: "Orange", color: "#EA580C", text: "#ffffff" },
    { id: "christmas", label: "Christmas", color: "#16A34A", text: "#ffffff" },
  ];

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="App theme">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => changeTheme(t.id)}
          aria-pressed={theme === t.id}
          style={{ backgroundColor: t.color, color: t.text }}
          className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
            theme === t.id
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "opacity-90 hover:opacity-100"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
