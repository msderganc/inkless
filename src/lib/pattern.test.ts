import { describe, expect, it } from "vitest";
import { batchRecords, substitute } from "./batch";
import {
  expandPattern,
  formatAmount,
  LIST_PRESETS,
  numberToLetters,
  parseAmount,
  parsePattern,
  toRoman,
} from "./pattern";

const expand = (p: string, limit = 500) =>
  expandPattern(parsePattern(p), limit).map((r) => r.text);

describe("amounts", () => {
  it("parses whole, negative, decimal, fraction and mixed numbers", () => {
    expect(parseAmount("3")).toEqual({ value: 3 });
    expect(parseAmount("-2")).toEqual({ value: -2 });
    expect(parseAmount("0.25")).toEqual({ value: 0.25, decimals: 2 });
    expect(parseAmount(".5")).toEqual({ value: 0.5, decimals: 1 });
    expect(parseAmount("1/4")).toEqual({ value: 0.25, denominator: 4 });
    expect(parseAmount("1 1/4")).toEqual({ value: 1.25, denominator: 4 });
    expect(parseAmount("1-1/4")).toEqual({ value: 1.25, denominator: 4 });
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1/0")).toBeNull();
  });

  it("formats fractions reduced, as mixed numbers", () => {
    const f = (v: number, d = 16) =>
      formatAmount(v, {
        style: "fraction",
        decimals: 0,
        denominator: d,
        pad: 0,
      });
    expect([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => f(v))).toEqual([
      "1/4",
      "1/2",
      "3/4",
      "1",
      "1 1/4",
      "1 1/2",
      "2",
    ]);
    expect(f(5 / 16)).toBe("5/16");
    expect(f(0.3, 8)).toBe("1/4"); // rounded to eighths
    expect(f(-0.5)).toBe("-1/2");
  });
});

describe("patterns", () => {
  it("expands number ranges with padding, steps and counting down", () => {
    expect(expand("{1-5}")).toEqual(["1", "2", "3", "4", "5"]);
    expect(expand("Shelf {08-11}")).toEqual([
      "Shelf 08",
      "Shelf 09",
      "Shelf 10",
      "Shelf 11",
    ]);
    expect(expand("{0-20:5}")).toEqual(["0", "5", "10", "15", "20"]);
    expect(expand("{3-1}")).toEqual(["3", "2", "1"]);
    expect(expand("{-2..2}")).toEqual(["-2", "-1", "0", "1", "2"]);
    expect(expand("{1-3:pad3}")).toEqual(["001", "002", "003"]);
  });

  it("steps by fractions and decimals (screw sizes)", () => {
    expect(expand('{1/4-1:1/4}"')).toEqual(['1/4"', '1/2"', '3/4"', '1"']);
    expect(expand("{1/16-1/4:1/16}")).toEqual(["1/16", "1/8", "3/16", "1/4"]);
    expect(expand("{1-2:1/4}")).toEqual(["1", "1 1/4", "1 1/2", "1 3/4", "2"]);
    expect(expand("{0.5-2:0.5} mm")).toEqual([
      "0.5 mm",
      "1.0 mm",
      "1.5 mm",
      "2.0 mm",
    ]);
    // 0.1 steps don't drift (0.30000000000000004).
    expect(expand("{0.1-0.3:0.1}")).toEqual(["0.1", "0.2", "0.3"]);
  });

  it("does letters, spreadsheet-style letters, Roman numerals and lists", () => {
    expect(expand("{A-E:2}")).toEqual(["A", "C", "E"]);
    expect(expand("{x-z}")).toEqual(["x", "y", "z"]);
    expect(expand("{Y-AB}")).toEqual(["Y", "Z", "AA", "AB"]);
    expect(expand("{1-4:ROMAN}")).toEqual(["I", "II", "III", "IV"]);
    expect(expand("{9-10:roman}")).toEqual(["ix", "x"]);
    expect(expand("{Red|Green}")).toEqual(["Red", "Green"]);
    expect(numberToLetters(703)).toBe("AAA");
    expect(toRoman(1994)).toBe("MCMXCIV");
  });

  it("multiplies groups, last fastest, and exposes each group", () => {
    const r = expandPattern(parsePattern("Bin {A-B}{1-3}"), 500);
    expect(r.map((x) => x.text)).toEqual([
      "Bin A1",
      "Bin A2",
      "Bin A3",
      "Bin B1",
      "Bin B2",
      "Bin B3",
    ]);
    expect(r[4]!.groups).toEqual(["B", "2"]);
  });

  it("refuses oversize and malformed patterns with clear messages", () => {
    expect(() => expand("{1-100}{1-100}")).toThrow(/10000 labels/);
    expect(() => expand("{1-}")).toThrow(/numbers or letters/);
    expect(() => expand("{abc}")).toThrow(/isn't a range or a list/);
    expect(() => expand("{1-5:0}")).toThrow(/valid step/);
  });
});

describe("pattern and sequence batches", () => {
  it("fills {n}, {g1}…, {i} and {total}", () => {
    const recs = batchRecords({
      kind: "pattern",
      pattern: "M{4|6} x {10-20:10}",
    });
    expect(recs).toHaveLength(4);
    expect(substitute("{n} ({g1}/{g2}) #{i} of {total}", recs[3]!)).toBe(
      "M6 x 20 (6/20) #4 of 4",
    );
  });

  it("numbers can count in fractions and decimals", () => {
    const fr = batchRecords({
      kind: "sequence",
      start: 0.25,
      step: 0.25,
      count: 4,
      pad: 0,
      prefix: "",
      suffix: '"',
      style: "fraction",
      decimals: 2,
      denominator: 16,
    });
    expect(fr.map((r) => r!.n)).toEqual(['1/4"', '1/2"', '3/4"', '1"']);
    // Older saved batches (no style) still count in whole numbers.
    const old = batchRecords({
      kind: "sequence",
      start: 7,
      step: 1,
      count: 2,
      pad: 3,
      prefix: "#",
      suffix: "",
    });
    expect(old.map((r) => r!.n)).toEqual(["#007", "#008"]);
  });

  it("gives a clear error for an empty or group-less pattern", () => {
    expect(() => batchRecords({ kind: "pattern", pattern: " " })).toThrow(
      /Type a pattern/,
    );
    expect(() => batchRecords({ kind: "pattern", pattern: "Bin" })).toThrow(
      /Add a range or list/,
    );
  });

  it("ships sensible size presets", () => {
    const sixteenths = LIST_PRESETS[0]!.items;
    expect(sixteenths.slice(0, 4)).toEqual(['1/16"', '1/8"', '3/16"', '1/4"']);
    expect(sixteenths.at(-1)).toBe('1"');
    for (const p of LIST_PRESETS) expect(p.items.length).toBeGreaterThan(3);
  });
});
