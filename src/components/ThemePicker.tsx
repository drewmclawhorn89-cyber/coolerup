import { useState, useEffect } from "react"

const THEMES = [
  { name: "Blue", color: "#2563EB", hsl: "221 83% 53%" },
  { name: "Purple", color: "#9333EA", hsl: "271 81% 56%" },
  { name: "Pink", color: "#EC4899", hsl: "330 81% 60%" },
  { name: "Green", color: "#16A34A", hsl: "142 76% 36%" },
  { name: "Orange", color: "#F97316", hsl: "24 94% 53%" },
  { name: "Red", color: "#DC2626", hsl: "0 72% 51%" },
  { name: "Black", color: "#000000", hsl: "0 0% 0%" },
]

export default function ThemePicker() {
  const [selected, setSelected] = useState(localStorage.getItem("coolerup-theme") || THEMES[0].hsl)

  useEffect(() => {
    // apply saved theme on load
    document.documentElement.style.setProperty("--primary", selected)
    localStorage.setItem("coolerup-theme", selected)
  }, [selected])

  return (
    <div className="p-4">
      <h3 className="font-bold mb-3">Pick Theme</h3>
      <div className="grid grid-cols-4 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.name}
            onClick={() => setSelected(t.hsl)}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 ${selected === t.hsl ? 'border-black dark:border-white' : 'border-transparent'}`}
          >
            <div 
              className="w-12 h-12 rounded-full" 
              style={{ backgroundColor: t.color }}
            />
            <span className="text-xs">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
