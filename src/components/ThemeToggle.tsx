"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  applyTheme,
  readTheme,
  saveTheme,
  type ThemeChoice,
} from "~/lib/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const SHORT = { system: "Auto", light: "Light", dark: "Dark" } as const;
const TEXT = {
  system: "Theme: follow Windows",
  light: "Theme: light",
  dark: "Theme: dark",
} as const;

/** Cycles System → Light → Dark. "System" follows the Windows setting live. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(readTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => applyTheme(readTheme());
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  const Icon = ICON[choice];
  return (
    <button
      type="button"
      title={`${TEXT[choice]} (click to change)`}
      aria-label={`${TEXT[choice]} (click to change)`}
      className="inline-flex h-7 items-center gap-1.5 rounded border border-neutral-300 px-2 text-xs text-neutral-700 hover:bg-neutral-100"
      onClick={() => {
        const next = NEXT[choice];
        saveTheme(next);
        setChoice(next);
      }}
    >
      <Icon size={14} aria-hidden />
      {SHORT[choice]}
    </button>
  );
}
