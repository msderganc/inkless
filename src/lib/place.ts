/** Where to put a new element so it doesn't land on top of existing ones. */
import { type Box } from "./snap";

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Position a w×h box inside `area`: the centre if it's free, otherwise the free spot nearest
 * the centre (scanning a `stepMm` grid). If nothing is free, the spot with the least overlap;
 * ties go to the one nearest the centre. Returns the top-left corner.
 */
export function findFreeSpot(
  w: number,
  h: number,
  area: Box,
  others: Box[],
  stepMm = 1,
): { x: number; y: number } {
  const bw = Math.min(w, area.w);
  const bh = Math.min(h, area.h);
  const cx = area.x + (area.w - bw) / 2;
  const cy = area.y + (area.h - bh) / 2;
  const candidates: { x: number; y: number; d: number }[] = [];
  const nx = Math.max(0, Math.floor((area.w - bw) / stepMm));
  const ny = Math.max(0, Math.floor((area.h - bh) / stepMm));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = area.x + i * stepMm;
      const y = area.y + j * stepMm;
      candidates.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    }
  }
  candidates.push({ x: cx, y: cy, d: 0 });
  candidates.sort((a, b) => a.d - b.d);
  let best = candidates[0]!;
  let bestOverlap = Infinity;
  for (const c of candidates) {
    const box = { x: c.x, y: c.y, w: bw, h: bh };
    const o = others.reduce((sum, b) => sum + overlap(box, b), 0);
    if (o === 0) return { x: round(c.x), y: round(c.y) };
    if (o < bestOverlap) {
      bestOverlap = o;
      best = c;
    }
  }
  return { x: round(best.x), y: round(best.y) };
}

const round = (v: number) => Math.round(v * 100) / 100;
