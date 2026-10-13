import { describe, expect, it } from "vitest";
import { substitute } from "./batch";
import {
  dayOfYear,
  formatDate,
  isoWeek,
  parseDateVar,
  shiftDate,
  VARIABLE_PRESETS,
} from "./datevars";
import { designUsesBatch, emptyDesign, newText } from "./design";

// Sunday 7 June 2026, 3:05:09 pm local time.
const at = new Date(2026, 5, 7, 15, 5, 9);

describe("formatDate", () => {
  it.each([
    ["m/d/yy", "6/7/26"],
    ["mm/dd/yy", "06/07/26"],
    ["m/d/yyyy", "6/7/2026"],
    ["dd/mm/yyyy", "07/06/2026"],
    ["yyyy-mm-dd", "2026-06-07"],
    ["yyyymmdd", "20260607"],
    ["mm.dd.yy", "06.07.26"],
    ["mmm d, yyyy", "Jun 7, 2026"],
    ["mmmm d, yyyy", "June 7, 2026"],
    ["ddd, mmm d", "Sun, Jun 7"],
    ["dddd, mmmm do", "Sunday, June 7th"],
    ["mm/yy", "06/26"],
    ["jjj", "158"],
    ["yyjjj", "26158"],
    ['"Week "ww', "Week 23"],
    ['"Q"q yyyy', "Q2 2026"],
    ["h:mm AM/PM", "3:05 PM"],
    ["h:mm am/pm", "3:05 pm"],
    ["HH:mm", "15:05"],
    ["h:mm", "15:05"], // no AM/PM: 24-hour, like Excel
    ["hh:mm:ss A/P", "03:05:09 P"],
    ["m/d/yy h:mm AM/PM", "6/7/26 3:05 PM"],
    ["mm:ss", "05:09"], // mm before ss = minutes
    ["\\d d", "d 7"],
  ])("%s → %s", (fmt, out) => {
    expect(formatDate(at, fmt, "en-US")).toBe(out);
  });

  it("writes ordinals correctly", () => {
    const day = (d: number) => formatDate(new Date(2026, 0, d), "do");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(day)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "31st",
    ]);
  });

  it("computes ISO weeks and day of year at year edges", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1); // Thursday
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53); // Friday of 2026's week 53
    expect(dayOfYear(new Date(2028, 11, 31))).toBe(366); // leap year
  });
});

describe("parseDateVar", () => {
  it("reads names, offsets with units, and formats", () => {
    expect(parseDateVar("today")).toMatchObject({ kind: "date", amount: 0 });
    expect(parseDateVar("today + 30")).toMatchObject({
      sign: 1,
      amount: 30,
      unit: "d",
    });
    expect(parseDateVar("today-2w:m/d/yy")).toMatchObject({
      sign: -1,
      amount: 2,
      unit: "w",
      format: "m/d/yy",
    });
    expect(parseDateVar("time+30min:HH:mm")).toMatchObject({
      kind: "time",
      unit: "min",
      format: "HH:mm",
    });
    expect(parseDateVar("time+2")).toMatchObject({ unit: "h" });
    expect(parseDateVar("year")).toMatchObject({ format: "yyyy" });
    expect(parseDateVar("n")).toBeNull();
    expect(parseDateVar("name")).toBeNull();
    expect(parseDateVar("today+")).toBeNull();
  });
});

describe("shiftDate", () => {
  it("clamps month and year offsets to the end of the month", () => {
    const jan31 = new Date(2026, 0, 31);
    expect(shiftDate(jan31, 1, 1, "m").getDate()).toBe(28);
    expect(shiftDate(new Date(2028, 1, 29), 1, 1, "y").getDate()).toBe(28);
    expect(shiftDate(jan31, -1, 2, "w").getDate()).toBe(17);
  });
});

describe("substitute with date variables", () => {
  it("fills formatted and offset dates", () => {
    expect(substitute("Packed {today:m/d/yy}", null, at)).toBe("Packed 6/7/26");
    expect(substitute("Best by {today+3m:mm/yy}", null, at)).toBe(
      "Best by 09/26",
    );
    expect(substitute("{time+2h:h:mm AM/PM}", null, at)).toBe("5:05 PM");
  });

  it("lets a spreadsheet column named like a variable win, except today/now", () => {
    expect(substitute("{year}", { year: "Vintage" }, at)).toBe("Vintage");
    expect(substitute("{today:yyyy}", { today: "x" }, at)).toBe("2026");
  });

  it("doesn't count date variables as batch placeholders", () => {
    const d = (text: string) => ({
      ...emptyDesign("x"),
      elements: [{ ...newText(0, 0, 5, 5), text }],
    });
    expect(designUsesBatch(d("{today:m/d/yy} {time} {year} {julian}"))).toBe(
      false,
    );
    expect(designUsesBatch(d("{today} {n}"))).toBe(true);
  });

  it("every preset renders to something other than its own text", () => {
    for (const g of VARIABLE_PRESETS)
      for (const p of g.items) {
        const out = substitute(p.value, null, at);
        expect(out).not.toContain("{");
        expect(out.length).toBeGreaterThan(0);
      }
  });
});
