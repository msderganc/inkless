/** 1-bit bitmap: one byte per pixel, 1 = black (printed), 0 = white. Row-major. */
export interface MonoBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export function createMono(width: number, height: number): MonoBitmap {
  return { width, height, data: new Uint8Array(width * height) };
}

/** RGBA → luminance (0 = black, 255 = white). Transparent pixels count as white paper. */
export function luminance(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = rgba[p + 3]! / 255;
    const l = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
    out[i] = Math.round(l * a + 255 * (1 - a));
  }
  return out;
}

export function threshold(
  gray: Uint8Array,
  width: number,
  height: number,
  level = 128,
): MonoBitmap {
  const bmp = createMono(width, height);
  for (let i = 0; i < gray.length; i++) bmp.data[i] = gray[i]! < level ? 1 : 0;
  return bmp;
}

/** Floyd–Steinberg error diffusion to 1 bit. */
export function dither(
  gray: Uint8Array,
  width: number,
  height: number,
): MonoBitmap {
  const buf = Float32Array.from(gray);
  const bmp = createMono(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i]!;
      const black = old < 128;
      bmp.data[i] = black ? 1 : 0;
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) buf[i + 1]! += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1]! += (err * 3) / 16;
        buf[i + width]! += (err * 5) / 16;
        if (x + 1 < width) buf[i + width + 1]! += err / 16;
      }
    }
  }
  return bmp;
}

/**
 * Grow (dots > 0) or thin (dots < 0) black areas by |dots| printer dots: dilation or erosion,
 * alternating cross and square neighbourhoods so edges stay roughly round. Outside the bitmap
 * counts as white.
 */
export function adjustThickness(bmp: MonoBitmap, dots: number): MonoBitmap {
  const { width: w, height: h } = bmp;
  let cur = bmp.data;
  const grow = dots > 0;
  for (let step = 0; step < Math.abs(dots); step++) {
    const square = step % 2 === 1;
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // Grow: black if any neighbour is black. Thin: white if any neighbour is white.
        let v = cur[i]!;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || (!square && dx !== 0 && dy !== 0))
              continue;
            const nx = x + dx;
            const ny = y + dy;
            const n =
              nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : cur[ny * w + nx]!;
            if (grow ? n : !n) v = grow ? 1 : 0;
          }
        }
        next[i] = v;
      }
    }
    cur = next;
  }
  return { ...bmp, data: cur };
}

export function invert(bmp: MonoBitmap): MonoBitmap {
  return { ...bmp, data: bmp.data.map((v) => (v ? 0 : 1)) };
}

/** Rotate rows [y0, y0+h) by 180° in place (jewelry panel 1). */
export function rotateBand180(bmp: MonoBitmap, y0: number, h: number): void {
  const start = Math.max(0, y0);
  const end = Math.min(bmp.height, y0 + h);
  const band = bmp.data.slice(start * bmp.width, end * bmp.width);
  band.reverse();
  bmp.data.set(band, start * bmp.width);
}

/** Fill rows [y0, y0+h) by tiling rows [src0, src0+srcH) (cable wrap repeat). */
export function tileBand(
  bmp: MonoBitmap,
  src0: number,
  srcH: number,
  y0: number,
  h: number,
): void {
  if (srcH <= 0) return;
  const w = bmp.width;
  const src = bmp.data.slice(src0 * w, (src0 + srcH) * w);
  for (let y = 0; y < h && y0 + y < bmp.height; y++) {
    const row = y % srcH;
    bmp.data.set(src.subarray(row * w, (row + 1) * w), (y0 + y) * w);
  }
}

export function cropColumns(
  bmp: MonoBitmap,
  start: number,
  width: number,
): MonoBitmap {
  const out = createMono(width, bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    out.data.set(
      bmp.data.subarray(y * bmp.width + start, y * bmp.width + start + width),
      y * width,
    );
  }
  return out;
}

/**
 * Shift content horizontally by `dots` (positive = right), keeping the width; columns shifted in
 * are blank and columns shifted past the edge are dropped. Used for print calibration.
 */
export function shiftColumns(bmp: MonoBitmap, dots: number): MonoBitmap {
  const d = Math.round(dots);
  if (d === 0) return bmp;
  const out = createMono(bmp.width, bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    const row = y * bmp.width;
    for (let x = 0; x < bmp.width; x++) {
      const src = x - d;
      if (src >= 0 && src < bmp.width) out.data[row + x] = bmp.data[row + src]!;
    }
  }
  return out;
}

/**
 * Place a label raster on a full printhead-width page, then move it by the calibration offset
 * (positive = right). The B21S print sequence sends rows only, so the printer always takes a
 * head-width page (see B21SPrintTask).
 *
 * Hardware-verified on Matthew's B21S (spec V12): a 31 mm round roll sits against the left end
 * of the head, so labels narrower than the head are left-aligned. Wider stock (50 mm) overhangs
 * the 48 mm head and is cropped symmetrically.
 */
export function positionOnHead(
  bmp: MonoBitmap,
  headDots: number,
  offsetDots = 0,
): MonoBitmap {
  const out = createMono(headDots, bmp.height);
  const base =
    bmp.width >= headDots ? Math.floor((headDots - bmp.width) / 2) : 0;
  const left = base + Math.round(offsetDots);
  for (let y = 0; y < bmp.height; y++) {
    const src = y * bmp.width;
    const dst = y * headDots;
    for (let x = 0; x < bmp.width; x++) {
      const dx = left + x;
      if (dx >= 0 && dx < headDots && bmp.data[src + x]) out.data[dst + dx] = 1;
    }
  }
  return out;
}

export function blackCount(bmp: MonoBitmap): number {
  let n = 0;
  for (const v of bmp.data) n += v;
  return n;
}
