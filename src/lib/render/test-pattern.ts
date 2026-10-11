import { DOTS_PER_MM, mmToDots, PRINTHEAD_DOTS } from "../geometry";
import { createMono, type MonoBitmap } from "./mono";

/**
 * Full-printhead calibration pattern (spec Phase 3: full-width test pattern):
 * a 1-dot border, millimetre ruler ticks across the head (long tick every 5 mm, longer every
 * 10 mm), a centre line, and five density blocks of increasing fill.
 */
export function testPattern(heightMm = 30, width = PRINTHEAD_DOTS): MonoBitmap {
  const height = mmToDots(heightMm);
  const bmp = createMono(width, height);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) bmp.data[y * width + x] = 1;
  };

  for (let x = 0; x < width; x++) {
    set(x, 0);
    set(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    set(0, y);
    set(width - 1, y);
    if (y % 4 < 2) set(Math.floor(width / 2), y);
  }

  for (let mm = 0; mm * DOTS_PER_MM < width; mm++) {
    const x = Math.round(mm * DOTS_PER_MM);
    const len = mm % 10 === 0 ? mmToDots(4) : mm % 5 === 0 ? mmToDots(2.5) : mmToDots(1.2);
    for (let y = 1; y <= len; y++) set(x, y);
  }

  // Density blocks: 20%, 40%, 60%, 80%, 100% ordered-dither fills.
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const top = mmToDots(8);
  const bottom = Math.min(height - mmToDots(3), top + mmToDots(12));
  const blockW = Math.floor((width - 2 * mmToDots(3)) / 5);
  for (let b = 0; b < 5; b++) {
    const level = ((b + 1) / 5) * 16;
    const x0 = mmToDots(3) + b * blockW;
    for (let y = top; y < bottom; y++) {
      for (let x = x0 + 2; x < x0 + blockW - 2; x++) {
        if (bayer[y % 4]![x % 4]! < level) set(x, y);
      }
    }
  }
  return bmp;
}
