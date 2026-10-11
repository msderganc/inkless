import { describe, expect, it } from "vitest";
import { nodeEnv, halfBlackPng } from "~/test/canvas-env";
import { CATALOGUE, findLabel, type LabelSpec } from "../catalogue";
import { type Design, designSchema, emptyDesign, type ImageElement, MAX_IMAGE_SRC_CHARS, newText, type TextElement } from "../design";
import { DOTS_PER_MM, mmToDots, PRINTHEAD_DOTS } from "../geometry";
import { regionContains, safeRegion } from "../shapes";
import { encodeForPrinter } from "./encode";
import { blackCount, type MonoBitmap } from "./mono";
import { renderLabel } from "./render";

/** A text element filling the whole label with a black block glyph (█) so coverage is predictable. */
function fullBlock(spec: LabelSpec): TextElement {
  return {
    ...newText(0, 0, spec.widthMm, spec.heightMm),
    text: "██████\n██████\n██████",
    fontSizeMm: spec.heightMm,
    autoFit: false,
  };
}

function blackOutsideSafe(bmp: MonoBitmap, spec: LabelSpec): number {
  const region = safeRegion(spec);
  let n = 0;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (bmp.data[y * bmp.width + x] && !regionContains(region, (x + 0.5) / DOTS_PER_MM, (y + 0.5) / DOTS_PER_MM)) {
        n++;
      }
    }
  }
  return n;
}

function design(spec: LabelSpec, elements: Design["elements"], repeatInWrap = false): Design {
  return { ...emptyDesign(spec.id), elements, repeatInWrap };
}

describe("renderLabel", () => {
  it.each(CATALOGUE.map((l) => [l.id, l] as const))("%s: output stays in the safe area and printhead", async (_, spec) => {
    const r = await renderLabel(design(spec, [fullBlock(spec)]), spec, nodeEnv);
    expect(r.label.width).toBe(mmToDots(spec.widthMm));
    expect(r.label.height).toBe(mmToDots(spec.heightMm));
    expect(r.print.width).toBeLessThanOrEqual(PRINTHEAD_DOTS);
    expect(blackCount(r.label)).toBeGreaterThan(0);
    expect(blackOutsideSafe(r.label, spec)).toBe(0);
    const enc = encodeForPrinter(r.print);
    expect(enc.cols).toBe(Math.ceil(r.print.width / 8) * 8);
    expect(enc.rows).toBe(r.print.height);
  });

  it("an empty design prints nothing", async () => {
    const spec = findLabel("rect-50x30")!;
    const r = await renderLabel(emptyDesign(spec.id), spec, nodeEnv);
    expect(blackCount(r.label)).toBe(0);
  });

  it("substitutes the batch value", async () => {
    const spec = findLabel("rect-50x30")!;
    const el = { ...newText(2, 2, 46, 26), text: "{n}", autoFit: false, fontSizeMm: 10 };
    const a = await renderLabel(design(spec, [el]), spec, nodeEnv, { batchValue: "1" });
    const b = await renderLabel(design(spec, [el]), spec, nodeEnv, { batchValue: "888" });
    expect(blackCount(b.label)).toBeGreaterThan(blackCount(a.label));
  });

  it("jewelry: panel 1 content is rotated 180° about the panel centre", async () => {
    const spec = findLabel("jewelry-30x70")!;
    const p1 = spec.panels![1];
    // A small block in the top-left of panel 1 should print in its bottom-right.
    const el: TextElement = {
      ...newText(2, p1.y + 2, 6, 6),
      text: "█",
      fontSizeMm: 6,
      autoFit: false,
      align: "left",
    };
    const r = await renderLabel(design(spec, [el]), spec, nodeEnv);
    const w = r.label.width;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < r.label.height; y++) {
      for (let x = 0; x < w; x++) {
        if (r.label.data[y * w + x]) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(0);
    const cx = sx / n / DOTS_PER_MM;
    const cy = sy / n / DOTS_PER_MM;
    expect(cx).toBeGreaterThan(spec.widthMm / 2);
    expect(cy).toBeGreaterThan(p1.y + p1.height / 2);
    expect(cy).toBeLessThan(p1.y + p1.height);

    // Design view keeps panel 1 upright, where the user placed it.
    const d = await renderLabel(design(spec, [el]), spec, nodeEnv, { view: "design" });
    let dy = 0;
    let dn = 0;
    for (let y = 0; y < d.label.height; y++) {
      for (let x = 0; x < w; x++) {
        if (d.label.data[y * w + x]) {
          dy += y;
          dn++;
        }
      }
    }
    expect(dy / dn / DOTS_PER_MM).toBeLessThan(p1.y + p1.height / 2);
  });

  it("cable: repeatInWrap tiles the flag into the wrap zone", async () => {
    const spec = findLabel("cable-25x78")!;
    const el = { ...newText(2, 2, 21, 10), text: "██", autoFit: false, fontSizeMm: 8 };
    const plain = await renderLabel(design(spec, [el]), spec, nodeEnv);
    const tiled = await renderLabel(design(spec, [el], true), spec, nodeEnv);
    const wrapStart = mmToDots(spec.wrap!.y) * plain.label.width;
    expect(blackCount({ ...plain.label, data: plain.label.data.subarray(wrapStart) })).toBe(0);
    expect(blackCount({ ...tiled.label, data: tiled.label.data.subarray(wrapStart) })).toBeGreaterThan(0);
  });

  it("images: threshold, dither and invert", async () => {
    const spec = findLabel("rect-40x30")!;
    const img: ImageElement = {
      id: "img",
      kind: "image",
      x: 5,
      y: 5,
      w: 20,
      h: 20,
      rotation: 0,
      src: halfBlackPng(40, 40),
      dither: false,
      threshold: 128,
      invert: false,
    };
    const normal = blackCount((await renderLabel(design(spec, [img]), spec, nodeEnv)).label);
    const inverted = blackCount((await renderLabel(design(spec, [{ ...img, invert: true }]), spec, nodeEnv)).label);
    const dithered = blackCount((await renderLabel(design(spec, [{ ...img, dither: true }]), spec, nodeEnv)).label);
    const area = mmToDots(20) * mmToDots(20);
    expect(normal / area).toBeCloseTo(0.5, 1);
    expect(inverted / area).toBeCloseTo(0.5, 1);
    expect(dithered / area).toBeCloseTo(0.5, 1);
  });

  it("rotated text runs vertically inside its box", async () => {
    const spec = findLabel("rect-50x30")!;
    const el = { ...newText(20, 2, 10, 26), text: "ROTATED TEXT", rotation: 90 as const };
    const r = await renderLabel(design(spec, [el]), spec, nodeEnv);
    const b = inkBounds(r.label);
    expect(b).toBeDefined();
    expect(b!.x0).toBeGreaterThanOrEqual(19.5);
    expect(b!.x1).toBeLessThanOrEqual(30.5);
    // A rotated line of text is much taller than it is wide; an unrotated one would be the reverse.
    expect(b!.y1 - b!.y0).toBeGreaterThan(2 * (b!.x1 - b!.x0));

    const flat = await renderLabel(design(spec, [{ ...el, w: 26, h: 10, x: 2, y: 2, rotation: 0 }]), spec, nodeEnv);
    const f = inkBounds(flat.label)!;
    expect(f.x1 - f.x0).toBeGreaterThan(2 * (f.y1 - f.y0));
  });

  it("calibration offset shifts the printed content, for narrow labels too", async () => {
    for (const id of ["rect-40x30", "rect-50x30"]) {
      const spec = findLabel(id)!;
      const el = { ...newText(10, 5, 10, 10), text: "█", autoFit: false, fontSizeMm: 8 };
      const base = await renderLabel(design(spec, [el]), spec, nodeEnv);
      const shifted = await renderLabel(design(spec, [el]), spec, nodeEnv, { offsetDots: 5 });
      expect(shifted.print.width).toBe(base.print.width);
      const bx = inkBounds(base.print, 1)!;
      const sx = inkBounds(shifted.print, 1)!;
      expect(sx.x0 - bx.x0).toBe(5);
      expect(blackCount(shifted.print)).toBe(blackCount(base.print));
    }
  });

  it("independent check: no ink within 1 mm of any die-cut edge or outside round labels", async () => {
    for (const id of ["rect-40x30", "rect-50x80", "round-31", "round-50"]) {
      const spec = findLabel(id)!;
      const r = await renderLabel(design(spec, [fullBlock(spec)]), spec, nodeEnv);
      const b = inkBounds(r.label)!;
      expect(b.x0).toBeGreaterThanOrEqual(1 - 0.15);
      expect(b.y0).toBeGreaterThanOrEqual(1 - 0.15);
      expect(b.x1).toBeLessThanOrEqual(spec.widthMm - 1 + 0.15);
      expect(b.y1).toBeLessThanOrEqual(spec.heightMm - 1 + 0.15);
      if (spec.family === "round") {
        const w = r.label.width;
        const c = spec.widthMm / 2;
        for (let i = 0; i < r.label.data.length; i++) {
          if (!r.label.data[i]) continue;
          const x = ((i % w) + 0.5) / DOTS_PER_MM;
          const y = (Math.floor(i / w) + 0.5) / DOTS_PER_MM;
          expect(Math.hypot(x - c, y - c)).toBeLessThanOrEqual(c - 1 + 0.15);
        }
      }
    }
    // 50 mm stock: nothing in the 1 mm strips the 48 mm head cannot reach.
    const wide = findLabel("rect-50x30")!;
    const r = await renderLabel(design(wide, [fullBlock(wide)]), wide, nodeEnv);
    const b = inkBounds(r.label, 1)!;
    // 400-dot raster, 384-dot head centred: columns 8..391 are reachable.
    expect(b.x0).toBeGreaterThanOrEqual(8);
    expect(b.x1).toBeLessThanOrEqual(392);
  });

  it("ignores images without an intrinsic size and clamps oversized boxes", async () => {
    const spec = findLabel("rect-40x30")!;
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64")}`;
    const img: ImageElement = {
      id: "i",
      kind: "image",
      x: 0,
      y: 0,
      w: 500,
      h: 500,
      rotation: 0,
      src: halfBlackPng(10, 10),
      dither: false,
      threshold: 128,
      invert: false,
    };
    await expect(renderLabel(design(spec, [img]), spec, nodeEnv)).resolves.toBeDefined();
    const noSize = await renderLabel(design(spec, [{ ...img, w: 10, h: 10, src: svg }]), spec, nodeEnv).catch(() => null);
    if (noSize) expect(blackCount(noSize.label)).toBe(0);
  });
});

describe("design schema bounds (untrusted imports)", () => {
  it("rejects absurd element geometry and oversized images", () => {
    const base = newText(0, 0, 10, 10);
    expect(designSchema.safeParse({ ...emptyDesign("x"), elements: [base] }).success).toBe(true);
    expect(designSchema.safeParse({ ...emptyDesign("x"), elements: [{ ...base, w: 1e6 }] }).success).toBe(false);
    expect(designSchema.safeParse({ ...emptyDesign("x"), elements: [{ ...base, x: -1e6 }] }).success).toBe(false);
    const huge: ImageElement = {
      id: "i",
      kind: "image",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      rotation: 0,
      src: `data:image/png;base64,${"A".repeat(MAX_IMAGE_SRC_CHARS)}`,
      dither: false,
      threshold: 128,
      invert: false,
    };
    expect(designSchema.safeParse({ ...emptyDesign("x"), elements: [huge] }).success).toBe(false);
  });
});

/** Ink bounding box in mm (or in dots when scale = 1). */
function inkBounds(bmp: MonoBitmap, scale = DOTS_PER_MM) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < bmp.data.length; i++) {
    if (!bmp.data[i]) continue;
    const x = i % bmp.width;
    const y = Math.floor(i / bmp.width);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  }
  if (x0 === Infinity) return undefined;
  return { x0: x0 / scale, y0: y0 / scale, x1: x1 / scale, y1: y1 / scale };
}

describe("encodeForPrinter", () => {
  it("rejects rasters wider than the printhead", () => {
    expect(() => encodeForPrinter({ width: 400, height: 1, data: new Uint8Array(400) })).toThrow(RangeError);
  });
});
