import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { ThemePicker } from "@/components/ThemePicker";
import { applyPrefs, readPref, writePref } from "@/lib/prefs";

it("persists theme previews without recoloring the document or app controls", () => {
  function Picker() {
    const [theme, setTheme] = useState("dark");
    return (
      <ThemePicker
        theme={theme}
        changeTheme={(value) => {
          writePref("theme", value);
          setTheme(value);
        }}
      />
    );
  }

  applyPrefs();
  const rootStyles = document.documentElement.style.cssText;
  const bodyStyles = document.body.style.cssText;
  render(<Picker />);

  for (const label of ["Blue", "Red", "Light", "System", "Dark"]) {
    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(readPref("theme")).toBe(label.toLowerCase());
    applyPrefs();
    expect(document.documentElement.style.cssText).toBe(rootStyles);
    expect(document.body.style.cssText).toBe(bodyStyles);
  }
});
