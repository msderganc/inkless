import { describe, expect, it } from "vitest";
import { mmToDots, PRINTHEAD_DOTS } from "../geometry";
import { RingLog } from "../ring-log";
import { encodeForPrinter } from "./encode";
import { blackCount } from "./mono";
import { testPattern } from "./test-pattern";

describe("testPattern", () => {
  it("spans the whole printhead with edge columns set", () => {
    const p = testPattern(30);
    expect(p.width).toBe(PRINTHEAD_DOTS);
    expect(p.height).toBe(mmToDots(30));
    for (const y of [0, 50, p.height - 1]) {
      expect(p.data[y * p.width]).toBe(1);
      expect(p.data[y * p.width + p.width - 1]).toBe(1);
    }
    expect(() => encodeForPrinter(p)).not.toThrow();
  });

  it("density blocks get darker left to right", () => {
    const p = testPattern(30);
    const y0 = mmToDots(10);
    const blockW = Math.floor((p.width - 2 * mmToDots(3)) / 5);
    const fill = (b: number) => {
      let n = 0;
      const x0 = mmToDots(3) + b * blockW + 2;
      for (let y = y0; y < y0 + 16; y++)
        for (let x = x0; x < x0 + 16; x++) n += p.data[y * p.width + x]!;
      return n;
    };
    const fills = [0, 1, 2, 3, 4].map(fill);
    expect(fills).toEqual([...fills].sort((a, b) => a - b));
    expect(fills[4]).toBe(256);
    expect(blackCount(p)).toBeGreaterThan(0);
  });
});

describe("RingLog", () => {
  it("keeps only the newest entries", () => {
    const log = new RingLog<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => log.push(n));
    expect(log.toArray()).toEqual([3, 4, 5]);
    log.clear();
    expect(log.size).toBe(0);
    expect(() => new RingLog(0)).toThrow(RangeError);
  });
});
