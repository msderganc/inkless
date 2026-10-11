import { describe, expect, it } from "vitest";
import {
  applyOverride,
  CATALOGUE,
  customRect,
  findLabel,
  SAFE_MARGIN_MM,
} from "./catalogue";
import { dotsToMm, printWindow } from "./geometry";
import { regionContains, safeRegion } from "./shapes";

describe("catalogue", () => {
  it("has unique ids", () => {
    const ids = CATALOGUE.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every shape family", () => {
    expect(new Set(CATALOGUE.map((l) => l.family))).toEqual(
      new Set(["rect", "round", "wave", "jewelry", "cable"]),
    );
  });

  it.each(CATALOGUE.map((l) => [l.id, l] as const))(
    "%s: safe area lies inside the outline and the printhead window",
    (_, spec) => {
      const region = safeRegion(spec);
      const win = printWindow(spec.widthMm);
      const minX = dotsToMm(win.start);
      const maxX = dotsToMm(win.start + win.width);
      let inside = 0;
      for (let y = 0; y <= spec.heightMm; y += 0.25) {
        for (let x = 0; x <= spec.widthMm; x += 0.25) {
          if (!regionContains(region, x, y)) continue;
          inside++;
          expect(x).toBeGreaterThanOrEqual(
            Math.max(SAFE_MARGIN_MM, minX) - 1e-9,
          );
          expect(x).toBeLessThanOrEqual(
            Math.min(spec.widthMm - SAFE_MARGIN_MM, maxX) + 1e-9,
          );
          expect(y).toBeGreaterThanOrEqual(SAFE_MARGIN_MM - 1e-9);
          expect(y).toBeLessThanOrEqual(spec.heightMm - SAFE_MARGIN_MM + 1e-9);
        }
      }
      expect(inside).toBeGreaterThan(0);
    },
  );

  it("jewelry panels and cable bands sit inside the label", () => {
    for (const l of CATALOGUE) {
      for (const b of [...(l.panels ?? []), l.flag, l.wrap]) {
        if (!b) continue;
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height).toBeLessThanOrEqual(l.heightMm);
      }
    }
  });

  it("all entries are unverified until measured on real rolls", () => {
    expect(CATALOGUE.every((l) => !l.verified)).toBe(true);
  });

  it("round safe area is a circle (corners excluded)", () => {
    const r = safeRegion(findLabel("round-50")!);
    expect(regionContains(r, 25, 25)).toBe(true);
    expect(regionContains(r, 3, 3)).toBe(false);
  });

  it("rect safe area excludes the rounded corner", () => {
    const r = safeRegion({ ...findLabel("rect-40x30")!, cornerRadiusMm: 5 });
    expect(regionContains(r, 1.05, 1.05)).toBe(false);
    expect(regionContains(r, 20, 1.05)).toBe(true);
  });

  it("jewelry safe area excludes the tail", () => {
    const r = safeRegion(findLabel("jewelry-30x70")!);
    expect(regionContains(r, 15, 10)).toBe(true);
    expect(regionContains(r, 15, 30)).toBe(true);
    expect(regionContains(r, 15, 60)).toBe(false);
  });
});

describe("customRect", () => {
  it("builds a rectangle", () => {
    expect(customRect(45, 25)).toMatchObject({
      family: "rect",
      widthMm: 45,
      heightMm: 25,
    });
  });
  it.each([
    [0, 10],
    [51, 10],
    [40, 0],
    [40, 201],
  ])("rejects %d × %d", (w, h) =>
    expect(() => customRect(w, h)).toThrow(RangeError),
  );
});

describe("applyOverride", () => {
  it("replaces measured geometry and keeps identity", () => {
    const spec = findLabel("jewelry-30x70")!;
    const out = applyOverride(spec, {
      panels: [
        { y: 1, height: 15 },
        { y: 16, height: 15 },
      ],
    });
    expect(out.panels?.[1].y).toBe(16);
    expect(out.id).toBe(spec.id);
  });
});
