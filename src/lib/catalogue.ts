/**
 * Label stock catalogue for the B21 family (spec: "Label shapes NIIMBOT sells for the B21 family").
 *
 * Convention: `widthMm` runs across the printhead and `heightMm` is the feed length, matching the
 * B21S `printDirection: "top"` (V5). Entries marked `verified: false` have geometry or feed
 * orientation that has not been measured on a real roll yet (Wave 5).
 */

export type ShapeFamily = "rect" | "round" | "wave" | "jewelry" | "cable";

export type StockColour = "white" | "clear" | "printed";

/** A horizontal band of the label, in mm from the top (leading edge). */
export interface Band {
  y: number;
  height: number;
}

export interface LabelSpec {
  id: string;
  name: string;
  family: ShapeFamily;
  widthMm: number;
  heightMm: number;
  stock: StockColour;
  perRoll?: number;
  verified: boolean;
  /** Corner radius of rectangular outlines. */
  cornerRadiusMm?: number;
  /** Jewelry tag: the two printable panels either side of the fold. Panel 1 prints rotated 180°. */
  panels?: [Band, Band];
  /** Cable label: printable flag and the wrap zone that goes round the cable. */
  flag?: Band;
  wrap?: Band;
}

/** Content is kept this far inside the die-cut outline. */
export const SAFE_MARGIN_MM = 1;

const rect = (
  w: number,
  h: number,
  perRoll: number,
  stock: StockColour = "white",
  note = "",
): LabelSpec => ({
  id: `rect-${w}x${h}${stock === "white" ? "" : `-${stock}`}`,
  name: `${w} × ${h} mm${note ? ` ${note}` : ""}${stock === "white" ? "" : ` (${stock})`}`,
  family: "rect",
  widthMm: w,
  heightMm: h,
  stock,
  perRoll,
  verified: false,
  cornerRadiusMm: 1.5,
});

const round = (d: number, perRoll: number, stock: StockColour): LabelSpec => ({
  id: `round-${d}${stock === "white" ? "" : `-${stock}`}`,
  name: `Round ${d} mm${stock === "white" ? "" : ` (${stock})`}`,
  family: "round",
  widthMm: d,
  heightMm: d,
  stock,
  perRoll,
  verified: false,
});

export const CATALOGUE: readonly LabelSpec[] = [
  rect(50, 15, 460),
  rect(40, 20, 320),
  rect(50, 20, 320, "printed"),
  rect(40, 30, 230),
  rect(40, 30, 230, "clear"),
  rect(50, 30, 230),
  rect(40, 60, 125, "printed"),
  rect(40, 70, 110),
  rect(50, 70, 110),
  rect(50, 80, 95),
  round(31, 210, "white"),
  round(31, 210, "clear"),
  round(50, 150, "white"),
  round(50, 150, "clear"),
  {
    id: "wave-34",
    name: "Wave round 34 mm (printed)",
    family: "wave",
    widthMm: 34,
    heightMm: 34,
    stock: "printed",
    perRoll: 200,
    verified: false,
  },
  {
    id: "jewelry-30x70",
    name: "Jewelry tag 30 × 70 mm",
    family: "jewelry",
    widthMm: 30,
    heightMm: 70,
    stock: "white",
    perRoll: 100,
    verified: false,
    cornerRadiusMm: 1.5,
    panels: [
      { y: 0, height: 20 },
      { y: 20, height: 20 },
    ],
  },
  {
    id: "jewelry-25x75",
    name: "Jewelry tag 25 × 75 mm",
    family: "jewelry",
    widthMm: 25,
    heightMm: 75,
    stock: "white",
    perRoll: 100,
    verified: false,
    cornerRadiusMm: 1.5,
    panels: [
      { y: 0, height: 20 },
      { y: 20, height: 20 },
    ],
  },
  {
    id: "cable-25x78",
    name: "Cable label 25 × 78 mm",
    family: "cable",
    widthMm: 25,
    heightMm: 78,
    stock: "white",
    perRoll: 100,
    verified: false,
    cornerRadiusMm: 1.5,
    flag: { y: 0, height: 38 },
    wrap: { y: 38, height: 40 },
  },
  {
    id: "cable-25x38",
    name: "Cable label 25 × 38 mm",
    family: "cable",
    widthMm: 25,
    heightMm: 38,
    stock: "white",
    perRoll: 100,
    verified: false,
    cornerRadiusMm: 1.5,
    flag: { y: 0, height: 19 },
    wrap: { y: 19, height: 19 },
  },
];

export const FAMILY_NAMES: Record<ShapeFamily, string> = {
  rect: "Rectangle",
  round: "Round",
  wave: "Wave round",
  jewelry: "Jewelry tag",
  cable: "Cable label",
};

export function findLabel(
  id: string,
  custom: readonly LabelSpec[] = [],
): LabelSpec | undefined {
  return CATALOGUE.find((l) => l.id === id) ?? custom.find((l) => l.id === id);
}

export const MAX_FEED_MM = 200;

export function customRect(widthMm: number, heightMm: number): LabelSpec {
  if (!(widthMm > 0 && widthMm <= 50))
    throw new RangeError("Width must be between 0 and 50 mm");
  if (!(heightMm > 0 && heightMm <= MAX_FEED_MM)) {
    throw new RangeError(`Length must be between 0 and ${MAX_FEED_MM} mm`);
  }
  return {
    id: `custom-${widthMm}x${heightMm}`,
    name: `Custom ${widthMm} × ${heightMm} mm`,
    family: "rect",
    widthMm,
    heightMm,
    stock: "white",
    verified: false,
    cornerRadiusMm: 1.5,
  };
}

/** Partial geometry overrides a user can save after measuring a real roll. */
export type LabelOverride = Partial<
  Pick<
    LabelSpec,
    "widthMm" | "heightMm" | "cornerRadiusMm" | "panels" | "flag" | "wrap"
  >
>;

export function applyOverride(
  spec: LabelSpec,
  override: LabelOverride | undefined,
): LabelSpec {
  return override ? { ...spec, ...override } : spec;
}
