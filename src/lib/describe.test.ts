import { describe, expect, it } from "vitest";
import { BatchError, jobRecords, substitute } from "./batch";
import { describeLocally } from "./describe";

const check = (t: string) => {
  try {
    jobRecords({ kind: "none" }, [t]);
    return undefined;
  } catch (e) {
    return e instanceof BatchError ? e.message : String(e);
  }
};
const text = (d: string) => describeLocally(d, check)?.text;
/** What the labels say: first … last and the count. */
const labels = (d: string) => {
  const t = text(d);
  if (!t) return null;
  const recs = jobRecords({ kind: "none" }, [t]);
  return {
    count: recs.length,
    first: substitute(t, recs[0] ?? null),
    last: substitute(t, recs.at(-1) ?? null),
  };
};

describe("describeLocally: ranges", () => {
  it.each([
    ["every quarter inch from 1/4 to 2 inches", '{1/4-2:1/4}"'],
    ["every 1/4 from 1/4 to 2", "{1/4-2:1/4}"],
    ["from 1/4 to 2 inches by 1/4", '{1/4-2:1/4}"'],
    ["every 0.5 mm from 0.5 to 5", "{0.5-5:0.5} mm"],
    ["1 to 100", "{1-100}"],
    ["001 through 250", "{001-250}"],
    ["10 down to 1", "{10-1}"],
    ["bins A1 to D5", "Bin {A-D}{1-5}"],
    ["shelves 1 to 20", "Shelf {1-20}"],
    ["box 1 of 12 to 12 of 12", "Box {1-12} of 12"],
    ["roman numerals 1 to 12", "{1-12:ROMAN}"],
    ["chapter lowercase roman 1 to 5", "Chapter {1-5:roman}"],
    ["letters A to Z", "{A-Z}"],
    ["every 5 from 0 to 100", "{0-100:5}"],
  ])("%s → %s", (d, out) => expect(text(d)).toBe(out));

  it("produces the labels people expect", () => {
    expect(labels("every quarter inch from 1/4 to 2 inches")).toEqual({
      count: 8,
      first: '1/4"',
      last: '2"',
    });
    expect(labels("bins A1 to D5")).toMatchObject({
      count: 20,
      first: "Bin A1",
      last: "Bin D5",
    });
  });
});

describe("describeLocally: dates", () => {
  it.each([
    ["best by 6 months from today", "Best by {today+6m:mmm yyyy}"],
    ["use by 7 days from today", "Use by {today+7:m/d/yy}"],
    ["packed today mm/dd/yy", "Packed {today:mm/dd/yy}"],
    [
      "best by 6 months from today, like Mar 2027",
      "Best by {today+6m:mmm yyyy}",
    ],
    [
      "expires 2 years from today as yyyy-mm-dd",
      "Expires {today+2y:yyyy-mm-dd}",
    ],
    ["today", "{today:m/d/yy}"],
    ["tomorrow in iso", "{today+1:yyyy-mm-dd}"],
  ])("%s → %s", (d, out) => expect(text(d)).toBe(out));
});

describe("describeLocally: lists and giving up", () => {
  it("turns lists into choices", () => {
    expect(text("red, green and blue")).toBe("{Red|Green|Blue}");
    expect(text("small or large")).toBe("{Small|Large}");
  });

  it("returns null when it isn't sure (the AI handles those)", () => {
    expect(
      text("metric bolts M3 to M10 in 10, 20 and 30 mm lengths"),
    ).toBeUndefined();
    expect(text("a label for my sister's birthday")).toBeUndefined();
    expect(text("")).toBeUndefined();
    expect(text("1 to 100000")).toBeUndefined(); // over the batch limit: not offered
  });
});
