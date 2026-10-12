import { type LabelSpec } from "./catalogue";
import { type DesignElement } from "./design";
import { type RectMm, safeRegion } from "./shapes";

export type AlignMode =
  "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/**
 * The area an element aligns within: the safe-area part that contains the element's centre (a
 * jewelry panel, the cable flag or wrap zone, the whole printable area of a rectangle), or the
 * square bounding the printable circle of round labels.
 */
export function alignmentArea(el: DesignElement, spec: LabelSpec): RectMm {
  const region = safeRegion(spec);
  if (region.kind === "circle") {
    return {
      x: region.cx - region.r,
      y: region.cy - region.r,
      w: 2 * region.r,
      h: 2 * region.r,
    };
  }
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const centreDistance = (r: RectMm) =>
    Math.abs(r.y + r.h / 2 - cy) + Math.abs(r.x + r.w / 2 - cx);
  const containing = region.rects.find(
    (r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h,
  );
  return (
    containing ??
    [...region.rects].sort((a, b) => centreDistance(a) - centreDistance(b))[0]!
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Move (not resize) an element so its box aligns within its alignment area. */
export function alignElement<T extends DesignElement>(
  el: T,
  spec: LabelSpec,
  mode: AlignMode,
): T {
  const a = alignmentArea(el, spec);
  switch (mode) {
    case "left":
      return { ...el, x: round(a.x) };
    case "hcenter":
      return { ...el, x: round(a.x + (a.w - el.w) / 2) };
    case "right":
      return { ...el, x: round(a.x + a.w - el.w) };
    case "top":
      return { ...el, y: round(a.y) };
    case "vcenter":
      return { ...el, y: round(a.y + (a.h - el.h) / 2) };
    case "bottom":
      return { ...el, y: round(a.y + a.h - el.h) };
  }
}

/**
 * Align several elements as one group: their combined bounding box is aligned within the area
 * of the first element, and every element moves by the same amount (keeps their arrangement).
 */
export function alignGroup<T extends DesignElement>(
  els: T[],
  spec: LabelSpec,
  mode: AlignMode,
): T[] {
  if (els.length <= 1) return els.map((e) => alignElement(e, spec, mode));
  const x0 = Math.min(...els.map((e) => e.x));
  const y0 = Math.min(...els.map((e) => e.y));
  const x1 = Math.max(...els.map((e) => e.x + e.w));
  const y1 = Math.max(...els.map((e) => e.y + e.h));
  const group = { ...els[0]!, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const moved = alignElement(group, spec, mode);
  const dx = moved.x - x0;
  const dy = moved.y - y0;
  return els.map((e) => ({ ...e, x: round(e.x + dx), y: round(e.y + dy) }));
}
