import { z } from "zod";

/**
 * A label design. Coordinates are mm from the label's top-left corner, with x across the
 * printhead and y along the feed. Jewelry panel 1 is designed upright; the renderer rotates it.
 */
export const rotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Rotation = z.infer<typeof rotationSchema>;

/** Elements beyond these bounds cannot be on any label; bounding them keeps rendering cheap. */
export const MAX_ELEMENT_MM = 500;
export const MAX_IMAGE_SRC_CHARS = 6_000_000;

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
  align: z.enum(["left", "center", "right"]),
  /** Shrink the font so the longest line fits the box width. */
  autoFit: z.boolean(),
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

export const elementSchema = z.discriminatedUnion("kind", [textElementSchema, imageElementSchema]);

export const designSchema = z.object({
  version: z.literal(1),
  labelId: z.string().min(1),
  elements: z.array(elementSchema).max(200),
  /** Cable labels: repeat the flag content along the wrap zone. */
  repeatInWrap: z.boolean(),
});

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type DesignElement = z.infer<typeof elementSchema>;
export type Design = z.infer<typeof designSchema>;

export function emptyDesign(labelId: string): Design {
  return { version: 1, labelId, elements: [], repeatInWrap: false };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function newText(x: number, y: number, w: number, h: number): TextElement {
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
    align: "center",
    autoFit: true,
  };
}

export const BATCH_PLACEHOLDER = "{n}";

export function designUsesBatch(design: Design): boolean {
  return design.elements.some((e) => e.kind === "text" && e.text.includes(BATCH_PLACEHOLDER));
}
