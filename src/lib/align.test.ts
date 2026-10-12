import { describe, expect, it } from "vitest";
import { alignElement, alignmentArea } from "./align";
import { findLabel } from "./catalogue";
import { newText } from "./design";

describe("alignElement", () => {
  it("centres a box on a round label in both directions", () => {
    const spec = findLabel("round-31")!;
    const el = { ...newText(2, 3, 10, 6) };
    const h = alignElement(el, spec, "hcenter");
    const v = alignElement(h, spec, "vcenter");
    expect(v.x + v.w / 2).toBeCloseTo(15.5, 2);
    expect(v.y + v.h / 2).toBeCloseTo(15.5, 2);
    expect(v.w).toBe(10);
    expect(v.h).toBe(6);
  });

  it("aligns to the edges of a rectangle's printable area", () => {
    const spec = findLabel("rect-40x30")!;
    const el = newText(5, 5, 10, 5);
    expect(alignElement(el, spec, "left").x).toBe(1);
    expect(alignElement(el, spec, "right").x).toBe(29);
    expect(alignElement(el, spec, "top").y).toBe(1);
    expect(alignElement(el, spec, "bottom").y).toBe(24);
  });

  it("aligns within the jewelry panel that contains the element", () => {
    const spec = findLabel("jewelry-30x70")!;
    const p1 = spec.panels![1];
    const el = newText(3, p1.y + 2, 10, 4);
    const out = alignElement(el, spec, "vcenter");
    expect(out.y + out.h / 2).toBeCloseTo(p1.y + p1.height / 2, 2);
    expect(alignmentArea(el, spec).y).toBeCloseTo(p1.y + 1, 5);
  });

  it("uses the nearest zone when the element sits in a gap", () => {
    const spec = findLabel("jewelry-30x70")!;
    const el = newText(3, 55, 10, 4); // in the tail, below both panels
    expect(alignmentArea(el, spec).y).toBeCloseTo(spec.panels![1].y + 1, 5);
  });
});
