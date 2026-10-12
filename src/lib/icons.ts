/** Built-in icon library (Lucide, ISC licence), converted to monochrome SVG for printing. */

type IconNode = [tag: string, attrs: Record<string, string | number>][];

/** Default line weight on Lucide's 24-unit grid: bolder than the on-screen 2 so it survives 203 DPI. */
export const DEFAULT_ICON_WEIGHT = 2.5;

const escapeAttr = (v: string | number) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

/** Lucide icon node → standalone SVG (black strokes, no fill) at the given line weight. */
export function lucideToSvg(
  node: IconNode,
  weight = DEFAULT_ICON_WEIGHT,
): string {
  const children = node
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .filter(([k]) => k !== "key")
          .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
          .join(" ")}/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512" ` +
    `fill="none" stroke="#000" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">` +
    `${children}</svg>`
  );
}

/** "ShoppingCart" → "shopping cart" (search text and display name). */
export function iconDisplayName(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}

export interface LibraryIcon {
  key: string;
  name: string;
  node: IconNode;
}

let cache: Promise<LibraryIcon[]> | undefined;

/** Lazily loads all Lucide icons (kept out of the main bundle). */
export function loadIconLibrary(): Promise<LibraryIcon[]> {
  cache ??= import("lucide").then(({ icons }) =>
    Object.entries(icons as unknown as Record<string, IconNode>)
      .map(([key, node]) => ({ key, name: iconDisplayName(key), node }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  return cache;
}

/** Ranked search: whole-word/prefix matches first, then substring matches. */
export function searchIcons(
  all: LibraryIcon[],
  query: string,
  limit = 120,
): LibraryIcon[] {
  const q = query.trim().toLowerCase();
  if (!q) return all.slice(0, limit);
  const terms = q.split(/\s+/);
  const scored: { icon: LibraryIcon; score: number }[] = [];
  for (const icon of all) {
    if (!terms.every((t) => icon.name.includes(t))) continue;
    const words = icon.name.split(" ");
    const score =
      (icon.name === q ? 0 : 10) +
      (words.some((w) => w.startsWith(terms[0]!)) ? 0 : 5) +
      icon.name.length / 100;
    scored.push({ icon, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.icon);
}
