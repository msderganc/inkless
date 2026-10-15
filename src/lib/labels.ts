import {
  applyOverride,
  CATALOGUE,
  customRect,
  findLabel,
  type LabelOverride,
  type LabelSpec,
} from "./catalogue";

/**
 * Catalogue labels whose roll size matches the RFID tag's `capacity`. The tag carries no size or
 * shape (V1), but NIIMBOT's per-roll counts are mostly distinct (e.g. 210 = 31 mm round).
 */
export function suggestLabelsForCapacity(
  capacity: number | undefined,
): LabelSpec[] {
  if (!capacity) return [];
  return CATALOGUE.filter((l) => l.perRoll === capacity);
}

/** Why a label's geometry is impossible (bands outside the label…), or undefined if it's fine. */
export function geometryProblem(spec: LabelSpec): string | undefined {
  const bands: [string, { y: number; height: number } | undefined][] = [
    ["panel 1", spec.panels?.[0]],
    ["panel 2", spec.panels?.[1]],
    ["flag", spec.flag],
    ["wrap", spec.wrap],
  ];
  for (const [name, b] of bands) {
    if (!b) continue;
    if (b.y < 0 || b.height <= 0 || b.y + b.height > spec.heightMm + 0.01)
      return `The ${name} (y ${b.y}, height ${b.height}) doesn't fit in a ${spec.heightMm} mm label.`;
  }
  const r = spec.cornerRadiusMm ?? 0;
  if (r > Math.min(spec.widthMm, spec.heightMm) / 2)
    return `A corner radius of ${r} mm is too big for a ${spec.widthMm} × ${spec.heightMm} mm label.`;
  return undefined;
}

/** Resolve a label id (catalogue or `custom-WxH`) to its spec with any saved measurement override. */
export function resolveLabel(
  id: string,
  overrides: Record<string, LabelOverride> = {},
): LabelSpec | undefined {
  let spec = findLabel(id);
  if (!spec) {
    const m = /^custom-(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(id);
    if (m) {
      try {
        spec = customRect(Number(m[1]), Number(m[2]));
      } catch {
        return undefined;
      }
    }
  }
  if (!spec) return undefined;
  const withOverride = applyOverride(spec, overrides[id]);
  // An impossible saved measurement would break rendering: fall back to the catalogue size.
  return geometryProblem(withOverride) ? spec : withOverride;
}
