/** Fonts that ship with Windows 10/11, so they render offline without any download. */
export const WINDOWS_FONTS = [
  "Arial",
  "Arial Black",
  "Bahnschrift",
  "Calibri",
  "Cambria",
  "Candara",
  "Comic Sans MS",
  "Consolas",
  "Constantia",
  "Corbel",
  "Courier New",
  "Ebrima",
  "Franklin Gothic Medium",
  "Gabriola",
  "Georgia",
  "Impact",
  "Ink Free",
  "Lucida Console",
  "Lucida Sans Unicode",
  "Palatino Linotype",
  "Segoe Print",
  "Segoe Script",
  "Segoe UI",
  "Segoe UI Black",
  "Segoe UI Light",
  "Segoe UI Semibold",
  "Sitka Text",
  "Sylfaen",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
] as const;

interface LocalFontData {
  family: string;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

/** True when the browser can list installed fonts (Chromium's Local Font Access API). */
export function canListInstalledFonts(): boolean {
  return typeof window !== "undefined" && "queryLocalFonts" in window;
}

/**
 * Every font family installed on this computer, sorted, without duplicates. The browser asks the
 * user for permission the first time. Throws if the API is missing or permission is refused.
 */
export async function listInstalledFonts(): Promise<string[]> {
  const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts })
    .queryLocalFonts;
  if (!query) throw new Error("This browser cannot list installed fonts.");
  const fonts = await query();
  return mergeFontLists(
    [],
    fonts.map((f) => f.family),
  );
}

/** Union of font lists, sorted case-insensitively, with blanks and duplicates removed. */
export function mergeFontLists(
  ...lists: readonly (readonly string[])[]
): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const name of list) {
      const trimmed = name.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase()))
        seen.set(trimmed.toLowerCase(), trimmed);
    }
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}
