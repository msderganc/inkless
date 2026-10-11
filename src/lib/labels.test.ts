import { describe, expect, it } from "vitest";
import { resolveLabel, suggestLabelsForCapacity } from "./labels";

describe("suggestLabelsForCapacity", () => {
  it("maps Matthew's roll (capacity 210) to the 31 mm round labels", () => {
    expect(suggestLabelsForCapacity(210).map((l) => l.id)).toEqual([
      "round-31",
      "round-31-clear",
    ]);
  });
  it("returns nothing for unknown or missing capacity", () => {
    expect(suggestLabelsForCapacity(undefined)).toEqual([]);
    expect(suggestLabelsForCapacity(9999)).toEqual([]);
  });
});

describe("resolveLabel", () => {
  it("finds catalogue labels and applies overrides", () => {
    expect(resolveLabel("rect-50x30")?.heightMm).toBe(30);
    expect(
      resolveLabel("rect-50x30", { "rect-50x30": { heightMm: 31 } })?.heightMm,
    ).toBe(31);
  });

  it("parses custom sizes", () => {
    expect(resolveLabel("custom-45x22.5")).toMatchObject({
      widthMm: 45,
      heightMm: 22.5,
      family: "rect",
    });
  });

  it("returns undefined for unknown or invalid ids", () => {
    expect(resolveLabel("nope")).toBeUndefined();
    expect(resolveLabel("custom-99x10")).toBeUndefined();
  });
});
