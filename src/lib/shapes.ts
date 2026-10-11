import { type Band, type LabelSpec, SAFE_MARGIN_MM } from "./catalogue";
import { dotsToMm, printWindow } from "./geometry";

/** The subset of CanvasRenderingContext2D used to trace shapes (works with browser and node canvases). */
export interface PathSink {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
}

/** Axis-aligned rectangle in mm. */
export interface RectMm {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
}

/** A printable region: a set of rounded rectangles and/or circles, in mm. */
export type Region =
  | { kind: "rects"; rects: RectMm[] }
  | { kind: "circle"; cx: number; cy: number; r: number };

/** Scallop depth of the wave-round outline. */
const WAVE_DEPTH_MM = 1.5;
const WAVE_LOBES = 16;

function bandRect(spec: LabelSpec, band: Band, xInset: number, yInset: number): RectMm {
  return {
    x: xInset,
    y: band.y + yInset,
    w: spec.widthMm - 2 * xInset,
    h: band.height - 2 * yInset,
    r: Math.max((spec.cornerRadiusMm ?? 0) - yInset, 0),
  };
}

/** Columns of 50 mm stock beyond the 384-dot printhead are unreachable (V5); 0.01 mm guards rounding. */
function headOverhangMm(widthMm: number): number {
  const win = printWindow(widthMm);
  return win.start > 0 ? dotsToMm(win.start) + 0.01 : 0;
}

/**
 * Area where content may be printed: the die-cut outline inset by SAFE_MARGIN_MM, further limited
 * to the columns the printhead can reach.
 */
export function safeRegion(spec: LabelSpec, margin = SAFE_MARGIN_MM): Region {
  const d = Math.min(spec.widthMm, spec.heightMm);
  const xInset = Math.max(margin, headOverhangMm(spec.widthMm));
  const circle = (r: number): Region => ({
    kind: "circle",
    cx: spec.widthMm / 2,
    cy: spec.heightMm / 2,
    r: Math.min(r, spec.widthMm / 2 - xInset),
  });
  switch (spec.family) {
    case "round":
      return circle(d / 2 - margin);
    case "wave":
      return circle(d / 2 - WAVE_DEPTH_MM - margin);
    case "jewelry":
      if (spec.panels) {
        return { kind: "rects", rects: spec.panels.map((p) => bandRect(spec, p, xInset, margin)) };
      }
      break;
    case "cable":
      if (spec.flag) {
        const bands = spec.wrap ? [spec.flag, spec.wrap] : [spec.flag];
        return { kind: "rects", rects: bands.map((b) => bandRect(spec, b, xInset, margin)) };
      }
      break;
    case "rect":
      break;
  }
  return {
    kind: "rects",
    rects: [bandRect(spec, { y: 0, height: spec.heightMm }, xInset, margin)],
  };
}

export function regionContains(region: Region, x: number, y: number): boolean {
  if (region.kind === "circle") {
    return (x - region.cx) ** 2 + (y - region.cy) ** 2 <= region.r ** 2;
  }
  return region.rects.some((r) => rectContains(r, x, y));
}

function rectContains(r: RectMm, x: number, y: number): boolean {
  if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) return false;
  const rad = Math.min(r.r ?? 0, r.w / 2, r.h / 2);
  if (rad <= 0) return true;
  // Inside the rect; only the corner squares need the radius check.
  const cx = Math.min(Math.max(x, r.x + rad), r.x + r.w - rad);
  const cy = Math.min(Math.max(y, r.y + rad), r.y + r.h - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2;
}

function traceRect(ctx: PathSink, r: RectMm, s: number) {
  const rad = Math.min(r.r ?? 0, r.w / 2, r.h / 2) * s;
  const x = r.x * s;
  const y = r.y * s;
  const w = r.w * s;
  const h = r.h * s;
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Trace a region at `scale` units per mm. Caller fills/strokes/clips. */
export function traceRegion(ctx: PathSink, region: Region, scale: number) {
  ctx.beginPath();
  if (region.kind === "circle") {
    ctx.arc(region.cx * scale, region.cy * scale, region.r * scale, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  for (const r of region.rects) traceRect(ctx, r, scale);
}

/** Trace the die-cut outline of the label at `scale` units per mm. */
export function traceOutline(ctx: PathSink, spec: LabelSpec, scale: number) {
  const w = spec.widthMm;
  const h = spec.heightMm;
  if (spec.family === "round") {
    traceRegion(ctx, { kind: "circle", cx: w / 2, cy: h / 2, r: Math.min(w, h) / 2 }, scale);
    return;
  }
  if (spec.family === "wave") {
    const cx = (w / 2) * scale;
    const cy = (h / 2) * scale;
    const outer = (Math.min(w, h) / 2) * scale;
    const depth = WAVE_DEPTH_MM * scale;
    ctx.beginPath();
    const steps = WAVE_LOBES * 12;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = outer - depth * (0.5 - 0.5 * Math.cos(a * WAVE_LOBES));
      const px = cx + rr * Math.cos(a);
      const py = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    return;
  }
  ctx.beginPath();
  traceRect(ctx, { x: 0, y: 0, w, h, r: spec.cornerRadiusMm ?? 0 }, scale);
}

/** Fold line (jewelry) or flag/wrap boundary (cable), in mm from the top. */
export function guideLines(spec: LabelSpec): number[] {
  if (spec.family === "jewelry" && spec.panels) return [spec.panels[1].y];
  if (spec.family === "cable" && spec.wrap) return [spec.wrap.y];
  return [];
}
