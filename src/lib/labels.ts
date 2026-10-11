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
  return spec ? applyOverride(spec, overrides[id]) : undefined;
}
