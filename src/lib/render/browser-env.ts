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
  async loadFonts(fonts) {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    // Installed fonts can also load lazily; wait (briefly) so text is never drawn invisibly.
    const ready = Promise.all(
      fonts.map((f) => document.fonts.load(f).catch(() => undefined)),
    );
    await Promise.race([ready, new Promise((r) => setTimeout(r, 3000))]);
  },
};
