import { describe, expect, it } from "vitest";
import { mmToDots, PRINTHEAD_DOTS, printWindow } from "./geometry";

describe("mmToDots", () => {
  it.each([
    [48, 384],
    [50, 400],
    [40, 320],
    [31, 248],
    [25, 200],
    [25.4, 203],
  ])("%d mm → %d dots", (mm, dots) => expect(mmToDots(mm)).toBe(dots));
});

describe("printWindow", () => {
  it("crops 50 mm stock symmetrically to the printhead", () => {
    expect(printWindow(50)).toEqual({ labelDots: 400, start: 8, width: PRINTHEAD_DOTS });
  });
  it("sends narrow labels whole", () => {
    expect(printWindow(40)).toEqual({ labelDots: 320, start: 0, width: 320 });
  });
  it("applies and clamps the calibration offset", () => {
    expect(printWindow(50, 3).start).toBe(11);
    expect(printWindow(50, 100).start).toBe(16);
    expect(printWindow(50, -100).start).toBe(0);
    expect(printWindow(40, 5).start).toBe(0);
  });
  it("rejects non-positive widths", () => {
    expect(() => printWindow(0)).toThrow(RangeError);
  });
});
