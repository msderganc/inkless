import { z } from "zod";

/**
 * A label design. Coordinates are mm from the label's top-left corner, with x across the
 * printhead and y along the feed. Jewelry panel 1 is designed upright; the renderer rotates it.
 */
export const rotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type Rotation = z.infer<typeof rotationSchema>;

/** Elements beyond these bounds cannot be on any label; bounding them keeps rendering cheap. */
export const MAX_ELEMENT_MM = 500;
export const MAX_IMAGE_SRC_CHARS = 6_000_000;
export const MAX_SVG_CHARS = 200_000;

const box = {
  id: z.string().min(1).max(100),
  x: z.number().finite().min(-MAX_ELEMENT_MM).max(MAX_ELEMENT_MM),
  y: z.number().finite().min(-MAX_ELEMENT_MM).max(MAX_ELEMENT_MM),
  w: z.number().positive().max(MAX_ELEMENT_MM),
  h: z.number().positive().max(MAX_ELEMENT_MM),
  rotation: rotationSchema,
};

export const textElementSchema = z.object({
  ...box,
  kind: z.literal("text"),
  text: z.string().max(2000),
  fontSizeMm: z.number().positive().max(100),
  fontFamily: z.string().min(1).max(100),
  bold: z.boolean(),
  // Added later: default to off so older templates and drafts still load.
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]),
  /** Shrink the font so the longest line fits the box width. */
  autoFit: z.boolean(),
  /**
   * Curved text along the circle inscribed in the box: "top" reads clockwise over the top,
   * "bottom" reads left to right along the bottom (classic round-label layout).
   */
  arc: z.enum(["none", "top", "bottom"]).default("none"),
});

export const imageElementSchema = z.object({
  ...box,
  kind: z.literal("image"),
  /** data: URL of the source image. */
  src: z.string().startsWith("data:image/").max(MAX_IMAGE_SRC_CHARS),
  dither: z.boolean(),
  /** 0–255; pixels darker than this print black (threshold mode). */
  threshold: z.number().int().min(0).max(255),
  invert: z.boolean(),
});

export const shapeElementSchema = z.object({
  ...box,
  kind: z.literal("shape"),
  /**
   * rect / ellipse fill the box; line runs across the middle of the box; frame follows the
   * label's own outline (round, rectangle, jewelry panels…) just inside the printable area.
   */
  shape: z.enum(["rect", "ellipse", "line", "frame"]),
  strokeMm: z.number().positive().max(20),
  fill: z.boolean(),
  /** Rectangle corner radius. */
  cornerMm: z.number().min(0).max(50),
  /** Frame: a second ring inside the first (classic double border). */
  double: z.boolean().default(false),
});

/** A monochrome vector icon (from the built-in library or AI), stored as sanitised SVG. */
export const iconElementSchema = z.object({
  ...box,
  kind: z.literal("icon"),
  svg: z.string().startsWith("<svg").max(MAX_SVG_CHARS),
  name: z.string().max(200),
  source: z.enum(["library", "ai"]),
  invert: z.boolean().default(false),
  /** Library icons: line weight on the 24-unit grid (the SVG is regenerated when it changes). */
  weight: z.number().min(0.5).max(6).optional(),
  /** Library icons: Lucide icon key, to regenerate at another weight. */
  libraryKey: z.string().max(100).optional(),
});

export const elementSchema = z.discriminatedUnion("kind", [
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  iconElementSchema,
]);

export const designSchema = z.object({
  version: z.literal(1),
  labelId: z.string().min(1),
  elements: z.array(elementSchema).max(200),
  /** Cable labels: repeat the flag content along the wrap zone. */
  repeatInWrap: z.boolean(),
});

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type IconElement = z.infer<typeof iconElementSchema>;
export type DesignElement = z.infer<typeof elementSchema>;
export type Design = z.infer<typeof designSchema>;

export function emptyDesign(labelId: string): Design {
  return { version: 1, labelId, elements: [], repeatInWrap: false };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function newText(
  x: number,
  y: number,
  w: number,
  h: number,
): TextElement {
  return {
    id: newId(),
    kind: "text",
    x,
    y,
    w,
    h,
    rotation: 0,
    text: "Text",
    fontSizeMm: Math.min(5, h * 0.8),
    fontFamily: "Arial",
    bold: false,
    italic: false,
    underline: false,
    align: "center",
    autoFit: true,
    arc: "none",
  };
}

export function newShape(
  shape: ShapeElement["shape"],
  x: number,
  y: number,
  w: number,
  h: number,
): ShapeElement {
  return {
    id: newId(),
    kind: "shape",
    shape,
    x,
    y,
    w,
    h: shape === "line" ? Math.max(1, Math.min(h, 2)) : h,
    rotation: 0,
    strokeMm: 0.5,
    fill: false,
    cornerMm: shape === "rect" ? 1.5 : 0,
    double: false,
  };
}

export function newIcon(
  svg: string,
  name: string,
  source: IconElement["source"],
  x: number,
  y: number,
  size: number,
): IconElement {
  return {
    id: newId(),
    kind: "icon",
    svg,
    name,
    source,
    x,
    y,
    w: size,
    h: size,
    rotation: 0,
    invert: false,
  };
}

/** {today}, {today+7}, {today - 3}: used by both substitution and placeholder detection. */
export const TODAY_RE = /^today\s*(?:([+-])\s*(\d{1,4}))?$/i;

/** Matches {name}, {n}, {today}, {today+7}, {Due Date}… (no nested braces). */
export const PLACEHOLDER_RE = /\{([^{}\n]{1,60})\}/g;

/** True if any text uses a placeholder that a batch (sequence, list or CSV column) fills. */
export function designUsesBatch(design: Design): boolean {
  return design.elements.some(
    (e) =>
      e.kind === "text" &&
      [...e.text.matchAll(PLACEHOLDER_RE)].some(
        (m) => !TODAY_RE.test(m[1]!.trim()),
      ),
  );
}
