"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  applyTheme,
  readTheme,
  saveTheme,
  type ThemeChoice,
} from "~/lib/theme";
import { IconButton } from "./IconButton";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;
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

  return (
    <IconButton
      icon={ICON[choice]}
      label={`${TEXT[choice]} (click to change)`}
      size="sm"
      onClick={() => {
        const next = NEXT[choice];
        saveTheme(next);
        setChoice(next);
      }}
    />
  );
}
