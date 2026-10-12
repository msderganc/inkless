import { describe, expect, it } from "vitest";
import { findFreeSpot } from "./place";

const area = { x: 1, y: 1, w: 48, h: 28 };

describe("findFreeSpot", () => {
  it("centres the first element", () => {
    expect(findFreeSpot(20, 10, area, [])).toEqual({ x: 15, y: 10 });
  });

  it("moves a new element off an existing one, staying inside the area", () => {
    const first = { x: 15, y: 10, w: 20, h: 10 };
    const p = findFreeSpot(10, 6, area, [first]);
    const box = { ...p, w: 10, h: 6 };
    const overlaps =
      box.x < first.x + first.w &&
      first.x < box.x + box.w &&
      box.y < first.y + first.h &&
      first.y < box.y + box.h;
    expect(overlaps).toBe(false);
    expect(box.x).toBeGreaterThanOrEqual(area.x);
    expect(box.y).toBeGreaterThanOrEqual(area.y);
    expect(box.x + box.w).toBeLessThanOrEqual(area.x + area.w);
    expect(box.y + box.h).toBeLessThanOrEqual(area.y + area.h);
  });

  it("minimises overlap when the label is full, and clamps oversize boxes", () => {
    const full = { x: 1, y: 1, w: 48, h: 28 };
    const p = findFreeSpot(10, 10, area, [full]);
    expect(p.x).toBeGreaterThanOrEqual(1);
    const big = findFreeSpot(100, 100, area, []);
    expect(big).toEqual({ x: 1, y: 1 });
  });
});
