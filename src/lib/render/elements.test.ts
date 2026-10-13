import { describe, expect, it } from "vitest";
import { nodeEnv } from "~/test/canvas-env";
import { findLabel, type LabelSpec } from "../catalogue";
import {
  type Design,
  type DesignElement,
  emptyDesign,
  newIcon,
  newShape,
  newText,
} from "../design";
import { DOTS_PER_MM } from "../geometry";
import { regionContains, safeRegion } from "../shapes";
import { blackCount, type MonoBitmap } from "./mono";
import { renderLabel, renderPreview } from "./render";

const design = (spec: LabelSpec, elements: DesignElement[]): Design => ({
  ...emptyDesign(spec.id),
  elements,
});

const at = (b: MonoBitmap, xMm: number, yMm: number) =>
  b.data[
    Math.round(yMm * DOTS_PER_MM) * b.width + Math.round(xMm * DOTS_PER_MM)
  ];

function bounds(b: MonoBitmap) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < b.data.length; i++) {
    if (!b.data[i]) continue;
    const x = i % b.width,
      y = Math.floor(i / b.width);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return {
    x0: x0 / DOTS_PER_MM,
    y0: y0 / DOTS_PER_MM,
    x1: x1 / DOTS_PER_MM,
    y1: y1 / DOTS_PER_MM,
  };
}

describe("shapes", () => {
  const spec = findLabel("rect-50x30")!;

  it("outlined rectangle: ink on the edge, hollow middle", async () => {
    const r = await renderLabel(
      design(spec, [
        { ...newShape("rect", 5, 5, 20, 10), cornerMm: 0, strokeMm: 1 },
      ]),
      spec,
      nodeEnv,
    );
    expect(at(r.label, 5.5, 10)).toBe(1);
    expect(at(r.label, 15, 10)).toBe(0);
  });

  it("filled ellipse is solid in the middle and empty at the box corner", async () => {
    const r = await renderLabel(
      design(spec, [{ ...newShape("ellipse", 5, 5, 20, 10), fill: true }]),
      spec,
      nodeEnv,
    );
    expect(at(r.label, 15, 10)).toBe(1);
    expect(at(r.label, 5.3, 5.3)).toBe(0);
  });

  it("line spans the box width at its stroke thickness", async () => {
    const r = await renderLabel(
      design(spec, [{ ...newShape("line", 5, 9, 30, 2), strokeMm: 0.5 }]),
      spec,
      nodeEnv,
    );
    const b = bounds(r.label);
    expect(b.x0).toBeCloseTo(5, 0);
    expect(b.x1).toBeCloseTo(35, 0);
    expect(b.y1 - b.y0).toBeLessThan(0.8);
  });

  it("thin strokes never vanish (at least one printer dot)", async () => {
    const r = await renderLabel(
      design(spec, [{ ...newShape("line", 5, 9, 30, 2), strokeMm: 0.01 }]),
      spec,
      nodeEnv,
    );
    expect(blackCount(r.label)).toBeGreaterThan(100);
  });

  it("frame follows a round label's outline inside the printable area", async () => {
    const round = findLabel("round-31")!;
    const r = await renderLabel(
      design(round, [{ ...newShape("frame", 0, 0, 31, 31), strokeMm: 0.6 }]),
      round,
      nodeEnv,
    );
    // Ink near the top of the circle, none in the middle, all inside the safe area.
    expect(at(r.label, 15.5, 1.5)).toBe(1);
    expect(at(r.label, 15.5, 15.5)).toBe(0);
    const region = safeRegion(round);
    for (let i = 0; i < r.label.data.length; i++) {
      if (!r.label.data[i]) continue;
      const x = ((i % r.label.width) + 0.5) / DOTS_PER_MM;
      const y = (Math.floor(i / r.label.width) + 0.5) / DOTS_PER_MM;
      expect(regionContains(region, x, y)).toBe(true);
    }
  });

  it("double frame adds a second ring", async () => {
    const round = findLabel("round-31")!;
    const single = await renderLabel(
      design(round, [{ ...newShape("frame", 0, 0, 31, 31), strokeMm: 0.5 }]),
      round,
      nodeEnv,
    );
    const double = await renderLabel(
      design(round, [
        { ...newShape("frame", 0, 0, 31, 31), strokeMm: 0.5, double: true },
      ]),
      round,
      nodeEnv,
    );
    expect(blackCount(double.label)).toBeGreaterThan(
      blackCount(single.label) * 1.7,
    );
  });
});

describe("icons", () => {
  const square =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512"><rect x="2" y="2" width="20" height="20" fill="#000"/></svg>';

  it("renders SVG icons to solid 1-bit ink, scaled to the box", async () => {
    const spec = findLabel("rect-50x30")!;
    const r = await renderLabel(
      design(spec, [newIcon(square, "square", "library", 10, 5, 20)]),
      spec,
      nodeEnv,
    );
    expect(at(r.label, 20, 15)).toBe(1);
    const b = bounds(r.label);
    expect(b.x1 - b.x0).toBeGreaterThan(15);
    expect(b.x1 - b.x0).toBeLessThan(20.5);
  });

  it("invert prints the background instead", async () => {
    const spec = findLabel("rect-50x30")!;
    const r = await renderLabel(
      design(spec, [
        { ...newIcon(square, "square", "library", 10, 5, 20), invert: true },
      ]),
      spec,
      nodeEnv,
    );
    expect(at(r.label, 20, 15)).toBe(0);
    expect(at(r.label, 10.4, 5.4)).toBe(1);
  });

  it("thickness grows or thins the printed black, a dot per step", async () => {
    const spec = findLabel("rect-50x30")!;
    const ring =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512"><circle cx="12" cy="12" r="8" fill="none" stroke="#000" stroke-width="3"/></svg>';
    const ink = async (thickness: number) =>
      blackCount(
        (
          await renderLabel(
            design(spec, [
              { ...newIcon(ring, "ring", "ai", 10, 5, 20), thickness },
            ]),
            spec,
            nodeEnv,
          )
        ).label,
      );
    const [thin, normal, thick] = await Promise.all([ink(-2), ink(0), ink(2)]);
    expect(thin).toBeLessThan(normal * 0.85);
    expect(thick).toBeGreaterThan(normal * 1.15);
    expect(thin).toBeGreaterThan(0);
  });
});

describe("curved text", () => {
  const round = findLabel("round-50")!;
  const el = (arc: "top" | "bottom") => ({
    ...newText(1, 1, 48, 48),
    text: "CURVED TEXT",
    fontSizeMm: 4,
    autoFit: false,
    arc,
  });

  it("top arc sits in the upper part of the circle, bottom arc in the lower", async () => {
    const top = await renderLabel(design(round, [el("top")]), round, nodeEnv);
    const bottom = await renderLabel(
      design(round, [el("bottom")]),
      round,
      nodeEnv,
    );
    expect(bounds(top.label).y1).toBeLessThan(25);
    expect(bounds(bottom.label).y0).toBeGreaterThan(25);
    // Curved: the run is wider than it is tall, and hugs the edge (not the centre).
    expect(at(top.label, 25, 25)).toBe(0);
    expect(bounds(top.label).y0).toBeLessThan(5);
  });

  it("autoFit shrinks long text to stay on the half circle", async () => {
    const long = {
      ...el("top"),
      text: "A VERY LONG NAME THAT WOULD WRAP AROUND THE WHOLE LABEL",
      fontSizeMm: 6,
      autoFit: true,
    };
    const r = await renderLabel(design(round, [long]), round, nodeEnv);
    expect(bounds(r.label).y1).toBeLessThan(27);
  });

  it("fills placeholders on curved text", async () => {
    const t = { ...el("bottom"), text: "{n}" };
    const one = await renderLabel(design(round, [t]), round, nodeEnv, {
      record: { n: "1" },
    });
    const many = await renderLabel(design(round, [t]), round, nodeEnv, {
      record: { n: "88888" },
    });
    expect(blackCount(many.label)).toBeGreaterThan(blackCount(one.label));
  });
});

describe("fonts", () => {
  it("waits for every visible text font before drawing (preview and print)", async () => {
    const spec = findLabel("rect-50x30")!;
    const asked: string[][] = [];
    const env = {
      ...nodeEnv,
      loadFonts: async (fonts: string[]) => {
        asked.push(fonts);
      },
    };
    const d = design(spec, [
      { ...newText(1, 1, 20, 8), fontFamily: "Segoe Script", italic: true },
      { ...newText(1, 10, 20, 8), fontFamily: "Arial" },
      { ...newText(1, 20, 20, 8), fontFamily: "Hidden Font", hidden: true },
    ]);
    await renderLabel(d, spec, env);
    await renderPreview(d, spec, env, 4);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toEqual([
      'italic 16px "Segoe Script", sans-serif',
      '16px "Arial", sans-serif',
    ]);
  });
});
