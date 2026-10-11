import { describe, expect, it } from "vitest";
import { BatchError, batchSpecSchema, batchValues, MAX_BATCH, parseList, substitute } from "./batch";

describe("batchValues", () => {
  it("none → one label without substitution", () => {
    expect(batchValues({ kind: "none" })).toEqual([null]);
  });

  it("sequence with padding, prefix and suffix", () => {
    expect(
      batchValues({ kind: "sequence", start: 8, step: 1, count: 3, pad: 3, prefix: "BIN-", suffix: "A" }),
    ).toEqual(["BIN-008A", "BIN-009A", "BIN-010A"]);
  });

  it("sequence with step and negative start", () => {
    expect(
      batchValues({ kind: "sequence", start: -2, step: 2, count: 3, pad: 2, prefix: "", suffix: "" }),
    ).toEqual(["-02", "00", "02"]);
  });

  it("list trims and skips blanks", () => {
    expect(batchValues({ kind: "list", items: [" a ", "", "b"] })).toEqual(["a", "b"]);
  });

  it("rejects empty lists and oversize batches", () => {
    expect(() => batchValues({ kind: "list", items: [" "] })).toThrow(BatchError);
    expect(() =>
      batchValues({ kind: "sequence", start: 1, step: 1, count: MAX_BATCH + 1, pad: 0, prefix: "", suffix: "" }),
    ).toThrow(BatchError);
    expect(() =>
      batchValues({ kind: "list", items: Array.from({ length: MAX_BATCH + 1 }, (_, i) => `${i}`) }),
    ).toThrow(BatchError);
  });

  it("schema rejects non-positive step and count", () => {
    const base = { kind: "sequence", start: 1, pad: 0, prefix: "", suffix: "" };
    expect(batchSpecSchema.safeParse({ ...base, step: 0, count: 1 }).success).toBe(false);
    expect(batchSpecSchema.safeParse({ ...base, step: -1, count: 1 }).success).toBe(false);
    expect(batchSpecSchema.safeParse({ ...base, step: 1, count: 0 }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("parseList splits lines", () => expect(parseList("a\r\nb\n\n c ")).toEqual(["a", "b", "c"]));
  it("substitute replaces every placeholder", () => expect(substitute("{n}/{n}", "7")).toBe("7/7"));
  it("substitute leaves text alone without a value", () => expect(substitute("{n}", null)).toBe("{n}"));
});
