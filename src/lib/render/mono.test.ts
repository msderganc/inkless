import { describe, expect, it } from "vitest";
import {
  blackCount,
  createMono,
  cropColumns,
  dither,
  luminance,
  type MonoBitmap,
  rotateBand180,
  threshold,
  tileBand,
} from "./mono";

export const bmpFrom = (w: number, rows: string[]) => {
  const b = createMono(w, rows.length);
  rows.forEach((r, y) => [...r].forEach((c, x) => (b.data[y * w + x] = c === "#" ? 1 : 0)));
  return b;
};

export const rowsOf = (b: MonoBitmap) =>
  Array.from({ length: b.height }, (_, y) =>
    [...b.data.subarray(y * b.width, (y + 1) * b.width)].map((v) => (v ? "#" : ".")).join(""),
  );

describe("mono", () => {
  it("luminance treats transparent as white", () => {
    const px = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
    expect([...luminance(px, 3, 1)]).toEqual([0, 255, 255]);
  });

  it("threshold", () => {
    expect([...threshold(new Uint8Array([0, 127, 128, 255]), 4, 1).data]).toEqual([1, 1, 0, 0]);
  });

  it("dither keeps the darkness of mid-grey near 50%", () => {
    const gray = new Uint8Array(64 * 64).fill(128);
    const ratio = blackCount(dither(gray, 64, 64)) / (64 * 64);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it("dither maps pure black and white exactly", () => {
    expect([...dither(new Uint8Array([0, 255, 0, 255]), 2, 2).data]).toEqual([1, 0, 1, 0]);
  });

  it("rotateBand180 rotates only the band", () => {
    const c = bmpFrom(3, ["#..", "##.", "...", "..."]);
    rotateBand180(c, 1, 2);
    expect(rowsOf(c)).toEqual(["#..", "...", ".##", "..."]);
  });

  it("tileBand repeats rows", () => {
    const b = bmpFrom(2, ["#.", ".#", "..", "..", "..", ".."]);
    tileBand(b, 0, 2, 2, 4);
    expect(rowsOf(b)).toEqual(["#.", ".#", "#.", ".#", "#.", ".#"]);
  });

  it("cropColumns", () => {
    expect(rowsOf(cropColumns(bmpFrom(4, ["#..#", ".##."]), 1, 2))).toEqual(["..", "##"]);
  });
});
