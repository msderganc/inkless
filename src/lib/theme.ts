export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "b21s-theme";

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveDark(choice: ThemeChoice, systemDark: boolean): boolean {
  return choice === "dark" || (choice === "system" && systemDark);
}

export function applyTheme(choice: ThemeChoice) {
  const dark = resolveDark(
    choice,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  document.documentElement.classList.toggle("dark", dark);
}

export function saveTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage unavailable (private window): the choice lasts for this page only.
  }
  applyTheme(choice);
}

/** Inline script for <head>: applies the saved theme before first paint (no light flash). */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;
