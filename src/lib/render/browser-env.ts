import { type Drawable, type RenderEnv } from "./render";

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const MAX_CACHED_IMAGES = 20;

function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The image could not be loaded."));
      img.src = src;
    });
    imageCache.set(src, p);
    // Bounded cache: evict the oldest entry.
    if (imageCache.size > MAX_CACHED_IMAGES)
      imageCache.delete(imageCache.keys().next().value!);
    p.catch(() => imageCache.delete(src));
  }
  return p;
}

export const browserEnv: RenderEnv = {
  createCanvas(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
  },
  loadImage: (src): Promise<Drawable> => loadImage(src),
  loadFonts: (fonts) => warmFonts(fonts).then(() => undefined),
};

/** One warm-up per font (shared by concurrent renders). */
const warming = new Map<string, Promise<void>>();
let warmHost: HTMLElement | undefined;
// Timers, not animation frames: frames pause in hidden tabs, which would stall rendering.
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function warmOne(font: string): Promise<void> {
  if (!warmHost) {
    warmHost = document.createElement("div");
    warmHost.setAttribute("aria-hidden", "true");
    // Rendered (so the font loads) but invisible and out of the layout.
    warmHost.style.cssText =
      "position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;white-space:nowrap";
    document.body.appendChild(warmHost);
  }
  const span = document.createElement("span");
  span.style.font = font;
  span.textContent = "Aa Bb 0123 Julianna ÄÖÜ";
  warmHost.appendChild(span);
  void span.offsetWidth; // lay it out now, which loads the font
  const loaded =
    "fonts" in document
      ? document.fonts.load(font).catch(() => [])
      : Promise.resolve([]);
  return Promise.race([loaded, pause(3000)])
    .then(() => pause(60))
    .then(() => undefined);
}

/**
 * Make sure fonts are really loaded before canvas text uses them. Canvas text in a font that
 * is still loading is drawn invisibly and never repaired. document.fonts.load() only covers web
 * fonts, so fonts installed on Windows are also used once in hidden page text, which makes the
 * browser load them. Resolves true if any font was new (the caller then redraws once more as a
 * safety net).
 */
export async function warmFonts(fonts: string[]): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const fresh = fonts.filter((f) => !warming.has(f));
  for (const f of fresh) warming.set(f, warmOne(f));
  await Promise.all(fonts.map((f) => warming.get(f) ?? Promise.resolve()));
  return fresh.length > 0;
}
