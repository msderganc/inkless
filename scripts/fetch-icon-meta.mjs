// Refreshes src/lib/icon-meta.json (icon categories and search tags) from lucide.dev, so the
// offline icon library can be filtered by category and searched by tag. Run after upgrading
// the `lucide` package: node scripts/fetch-icon-meta.mjs
import { writeFileSync } from "node:fs";
import { icons } from "lucide";

const get = async (path) => {
  const res = await fetch(`https://lucide.dev/api/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

const norm = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const isStringMap = (v) =>
  v &&
  typeof v === "object" &&
  Object.values(v).every((a) => Array.isArray(a) && a.every((s) => typeof s === "string"));

const [categories, tags] = await Promise.all([get("categories"), get("tags")]);
if (!isStringMap(categories) || !isStringMap(tags)) throw new Error("Unexpected data shape");

const wanted = new Set(Object.keys(icons).map(norm));
const names = [...new Set(Object.values(categories).flat())]
  .filter((c) => /^[a-z0-9-]{1,40}$/.test(c))
  .sort();
const index = new Map(names.map((c, i) => [c, i]));

const out = {};
for (const [key, cats] of Object.entries(categories)) {
  const k = norm(key);
  if (!wanted.has(k)) continue;
  out[k] = {
    c: cats.filter((c) => index.has(c)).map((c) => index.get(c)),
    t: (tags[key] ?? [])
      .map((t) => t.toLowerCase().replace(/[^\p{L}\p{N} &'-]/gu, "").trim())
      .filter(Boolean)
      .slice(0, 20)
      .join("|"),
  };
}
writeFileSync(
  "src/lib/icon-meta.json",
  JSON.stringify({ source: "https://lucide.dev/api", categories: names, icons: out }),
);
console.log(`icon-meta: ${Object.keys(out).length} icons, ${names.length} categories`);
