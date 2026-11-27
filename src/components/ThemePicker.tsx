import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemePicker({
  theme,
  changeTheme,
}: {
  theme: string;
  changeTheme: (id: string) => void;
}) {
  const themes = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
    { id: "blue", label: "Blue" },
    { id: "purple", label: "Purple" },
    { id: "pink", label: "Pink" },
    { id: "green", label: "Green" },
    { id: "red", label: "Red" },
    { id: "christmas", label: "Christmas" },
  ];

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="App theme">
      {themes.map((t) => (
        <Button
          variant="outline"
          key={t.id}
          type="button"
          onClick={() => changeTheme(t.id)}
          aria-pressed={theme === t.id}
          className="gap-2"
        >
          <Check className={`h-4 w-4 text-theme-detail ${theme === t.id ? "visible" : "invisible"}`} />
          {t.label}
        </Button>
      ))}
    </div>
  );
}
