import {
  applyOverride,
  customRect,
  findLabel,
  type LabelOverride,
  type LabelSpec,
} from "./catalogue";

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
