/** Snapping while dragging: align a box's edges/centre to label guides and other elements. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapResult {
  x: number;
  y: number;
  /** Guide positions (mm) that were snapped to, for drawing. */
  guidesX: number[];
  guidesY: number[];
}

export const SNAP_MM = 0.75;

function snapAxis(
  start: number,
  size: number,
  targets: number[],
  threshold: number,
) {
  const anchors = [start, start + size / 2, start + size];
  let best: { delta: number; at: number } | undefined;
  for (const t of targets) {
    for (const a of anchors) {
      const d = t - a;
      if (
        Math.abs(d) <= threshold &&
        (!best || Math.abs(d) < Math.abs(best.delta))
      ) {
        best = { delta: d, at: t };
      }
    }
  }
  return best;
}

/**
 * Snap a moving box. Targets are x and y lines (mm), e.g. label centre, printable-area edges,
 * and other elements' edges and centres. Returns the snapped position and the lines it hit.
 */
export function snapMove(
  box: Box,
  targetsX: number[],
  targetsY: number[],
  threshold = SNAP_MM,
): SnapResult {
  const sx = snapAxis(box.x, box.w, targetsX, threshold);
  const sy = snapAxis(box.y, box.h, targetsY, threshold);
  return {
    x: box.x + (sx?.delta ?? 0),
    y: box.y + (sy?.delta ?? 0),
    guidesX: sx ? [sx.at] : [],
    guidesY: sy ? [sy.at] : [],
  };
}

/** Left, centre and right (or top, middle, bottom) lines of boxes. */
export function boxLines(boxes: Box[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const b of boxes) {
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

/** Bounding box of several boxes. */
export function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
