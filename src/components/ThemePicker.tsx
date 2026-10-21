export function ThemePicker({ theme, changeTheme }: any) {
  const themes = [
    { id: "light", label: "Light", color: "#ffffff", text: "#000000" },
    { id: "dark", label: "Dark", color: "#000000", text: "#ffffff" },
    { id: "system", label: "System", color: "#e5e7eb", text: "#000000" },
    { id: "blue", label: "Blue", color: "#2563EB", text: "#ffffff" },
    { id: "purple", label: "Purple", color: "#9333EA", text: "#ffffff" },
    { id: "pink", label: "Pink", color: "#EC4899", text: "#ffffff" },
    { id: "green", label: "Green", color: "#16A34A", text: "#ffffff" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {themes.map((t) => (
        <button
          key={t.id}
          onClick={() => changeTheme(t.id)}
          style={{ backgroundColor: t.color, color: t.text }}
          className={`rounded-md px-4 py-2 border text-sm font-medium ${
            theme === t.id ? "ring-2 ring-offset-2 ring-black" : ""
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
