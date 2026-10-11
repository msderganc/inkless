/** B21S printhead: 203 DPI, 384 dots wide (NiimBlueLib model metadata, spec finding). */
export const DPI = 203;
export const PRINTHEAD_DOTS = 384;
export const DOTS_PER_MM = DPI / 25.4;

export function mmToDots(mm: number): number {
  return Math.round(mm * DOTS_PER_MM);
}

export function dotsToMm(dots: number): number {
  return dots / DOTS_PER_MM;
}

/**
 * Horizontal window of the full label raster that the printhead can reach.
 *
 * The label is rendered at its full width; labels wider than the printhead are cropped
 * symmetrically. (Calibration is applied afterwards by shifting the content, see shiftColumns.)
 */
export interface PrintWindow {
  /** Full label raster width in dots. */
  labelDots: number;
  /** First label column sent to the printer. */
  start: number;
  /** Number of columns sent to the printer (≤ PRINTHEAD_DOTS). */
  width: number;
}

export function printWindow(labelWidthMm: number): PrintWindow {
  if (!(labelWidthMm > 0)) throw new RangeError("Label width must be positive");
  const labelDots = mmToDots(labelWidthMm);
  const width = Math.min(labelDots, PRINTHEAD_DOTS);
  return { labelDots, start: Math.floor((labelDots - width) / 2), width };
}
