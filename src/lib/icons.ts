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
  /** Lucide categories, e.g. "animals", "food-beverage". */
  categories: string[];
  /** Extra search words, e.g. "kitten feline" for cat. */
  tags: string[];
  /** Old Lucide name for the same drawing as another icon; hidden in the library list. */
  alias?: boolean;
}

interface IconMeta {
  categories: string[];
  icons: Record<string, { c: number[]; t: string }>;
}

const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "food-beverage" → "Food & beverage". */
export function categoryLabel(c: string): string {
  const s = c.replace("food-beverage", "food & beverage").replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let cache: Promise<{ icons: LibraryIcon[]; categories: string[] }> | undefined;

/** Lazily loads all Lucide icons with their categories and tags (kept out of the main bundle). */
export function loadIconCatalog(): Promise<{
  icons: LibraryIcon[];
  categories: string[];
}> {
  cache ??= Promise.all([import("lucide"), import("./icon-meta.json")]).then(
    ([{ icons }, metaModule]) => {
      const meta = (metaModule as { default: IconMeta }).default;
      const entries = Object.entries(
        icons as unknown as Record<string, IconNode>,
      );
      // Metadata per drawing, so old alias names inherit their current icon's categories.
      const byDrawing = new Map<string, IconMeta["icons"][string]>();
      for (const [key, node] of entries) {
        const m = meta.icons[normKey(key)];
        if (m) byDrawing.set(JSON.stringify(node), m);
      }
      const list = entries
        .map(([key, node]): LibraryIcon => {
          const own = meta.icons[normKey(key)];
          const m = own ?? byDrawing.get(JSON.stringify(node));
          return {
            key,
            name: iconDisplayName(key),
            node,
            categories: (m?.c ?? [])
              .map((i) => meta.categories[i])
              .filter((c): c is string => !!c),
            tags: m?.t ? m.t.split("|") : [],
            ...(own ? {} : { alias: true }),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { icons: list, categories: meta.categories };
    },
  );
  return cache;
}

/** Lazily loads all Lucide icons (kept out of the main bundle). */
export async function loadIconLibrary(): Promise<LibraryIcon[]> {
  return (await loadIconCatalog()).icons;
}

/** Icons in a category and/or starting with a letter ("#" = digits). */
export function filterIcons(
  all: LibraryIcon[],
  { category, letter }: { category?: string; letter?: string },
): LibraryIcon[] {
  return all.filter(
    (i) =>
      (!category || i.categories.includes(category)) &&
      (!letter ||
        (letter === "#" ? /^[0-9]/.test(i.name) : i.name.startsWith(letter))),
  );
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
    const inName = terms.every((t) => icon.name.includes(t));
    // Tags widen the search ("kitten" finds cat) but rank below name matches.
    const inTags =
      !inName &&
      terms.every(
        (t) => icon.name.includes(t) || icon.tags.some((g) => g.includes(t)),
      );
    if (!inName && !inTags) continue;
    const words = icon.name.split(" ");
    const score =
      (icon.name === q ? 0 : 10) +
      (words.some((w) => w.startsWith(terms[0]!)) ? 0 : 5) +
      (inTags ? 20 : 0) +
      icon.name.length / 100;
    scored.push({ icon, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.icon);
}
