import { describe, expect, it } from "vitest";
import { resolveLabel } from "./labels";

describe("resolveLabel", () => {
  it("finds catalogue labels and applies overrides", () => {
    expect(resolveLabel("rect-50x30")?.heightMm).toBe(30);
    expect(resolveLabel("rect-50x30", { "rect-50x30": { heightMm: 31 } })?.heightMm).toBe(31);
  });

  it("parses custom sizes", () => {
    expect(resolveLabel("custom-45x22.5")).toMatchObject({ widthMm: 45, heightMm: 22.5, family: "rect" });
  });

  it("returns undefined for unknown or invalid ids", () => {
    expect(resolveLabel("nope")).toBeUndefined();
    expect(resolveLabel("custom-99x10")).toBeUndefined();
  });
});
