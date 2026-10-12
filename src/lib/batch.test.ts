import { describe, expect, it } from "vitest";
import {
  BatchError,
  batchRecords,
  batchSpecSchema,
  MAX_BATCH,
  parseCsv,
  parseList,
  recordLabel,
  substitute,
} from "./batch";

const seq = (over: object = {}) => ({
  kind: "sequence" as const,
  start: 1,
  step: 1,
  count: 3,
  pad: 0,
  prefix: "",
  suffix: "",
  ...over,
});

describe("batchRecords", () => {
  it("none → one label without values", () => {
    expect(batchRecords({ kind: "none" })).toEqual([null]);
  });

  it("sequence with padding, prefix and suffix", () => {
    expect(
      batchRecords(seq({ start: 8, pad: 3, prefix: "BIN-", suffix: "A" })),
    ).toEqual([{ n: "BIN-008A" }, { n: "BIN-009A" }, { n: "BIN-010A" }]);
  });

  it("sequence with step and negative start", () => {
    expect(batchRecords(seq({ start: -2, step: 2, pad: 2 }))).toEqual([
      { n: "-02" },
      { n: "00" },
      { n: "02" },
    ]);
  });

  it("list trims and skips blanks", () => {
    expect(batchRecords({ kind: "list", items: [" a ", "", "b"] })).toEqual([
      { n: "a" },
      { n: "b" },
    ]);
  });

  it("csv rows become records keyed by column, skipping blank rows", () => {
    const spec = {
      kind: "csv" as const,
      fileName: "kids.csv",
      columns: ["name", "class"],
      rows: [["Hailey", "3B"], ["", ""], ["Sam"]],
    };
    const recs = batchRecords(spec);
    expect(recs).toEqual([
      { n: "1", name: "Hailey", class: "3B" },
      { n: "2", name: "Sam", class: "" },
    ]);
    expect(recordLabel(spec, recs[0]!)).toBe("Hailey");
  });

  it("rejects empty lists/spreadsheets and oversize batches", () => {
    expect(() => batchRecords({ kind: "list", items: [" "] })).toThrow(
      BatchError,
    );
    expect(() =>
      batchRecords({
        kind: "csv",
        fileName: "x",
        columns: ["a"],
        rows: [[""]],
      }),
    ).toThrow(BatchError);
    expect(() => batchRecords(seq({ count: MAX_BATCH + 1 }))).toThrow(
      BatchError,
    );
    expect(() =>
      batchRecords({
        kind: "list",
        items: Array.from({ length: MAX_BATCH + 1 }, (_, i) => `${i}`),
      }),
    ).toThrow(BatchError);
  });

  it("schema rejects non-positive step and count", () => {
    expect(batchSpecSchema.safeParse(seq({ step: 0 })).success).toBe(false);
    expect(batchSpecSchema.safeParse(seq({ step: -1 })).success).toBe(false);
    expect(batchSpecSchema.safeParse(seq({ count: 0 })).success).toBe(false);
  });
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas/newlines, CRLF and a BOM", () => {
    const csv = '﻿name,note\r\n"Smith, Jo","said ""hi""\nthere"\r\nAmy,ok\r\n';
    expect(parseCsv(csv)).toEqual({
      columns: ["name", "note"],
      rows: [
        ["Smith, Jo", 'said "hi"\nthere'],
        ["Amy", "ok"],
      ],
    });
  });

  it("detects semicolon and tab separators", () => {
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([["1", "2"]]);
  });

  it("makes blank and duplicate column names unique, strips braces", () => {
    expect(parseCsv("name,,Name,{qty}\n1,2,3,4").columns).toEqual([
      "name",
      "col2",
      "Name_3",
      "qty",
    ]);
  });

  it("pads short rows and rejects empty files", () => {
    expect(parseCsv("a,b,c\n1").rows).toEqual([["1", "", ""]]);
    expect(() => parseCsv("\n\n")).toThrow(BatchError);
  });
});

describe("substitute", () => {
  const now = new Date(2026, 9, 12); // 12 Oct 2026, local time
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  it("fills batch values case-insensitively and leaves unknowns", () => {
    expect(substitute("{n}/{N}", { n: "7" }, now, iso)).toBe("7/7");
    expect(
      substitute("Hi {Name} ({unknown})", { name: "Hailey" }, now, iso),
    ).toBe("Hi Hailey ({unknown})");
    expect(substitute("{n}", null, now, iso)).toBe("{n}");
  });

  it("fills {today} and {today±N} across month boundaries", () => {
    expect(substitute("{today}", null, now, iso)).toBe("2026-10-12");
    expect(substitute("Use by {today+30}", null, now, iso)).toBe(
      "Use by 2026-11-11",
    );
    expect(substitute("{ today - 12 }", null, now, iso)).toBe("2026-09-30");
  });
});

describe("parseList", () => {
  it("splits lines", () =>
    expect(parseList("a\r\nb\n\n c ")).toEqual(["a", "b", "c"]));
});
