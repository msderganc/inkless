import { describe, expect, it } from "vitest";
import { mergeFontLists, WINDOWS_FONTS } from "./fonts";

describe("fonts", () => {
  it("offers a sorted Windows font list including the original fonts", () => {
    for (const f of [
      "Arial",
      "Segoe UI",
      "Calibri",
      "Consolas",
      "Times New Roman",
      "Georgia",
      "Impact",
      "Verdana",
    ]) {
      expect(WINDOWS_FONTS).toContain(f);
    }
    expect(WINDOWS_FONTS.length).toBeGreaterThanOrEqual(30);
  });

  it("merges lists without duplicates, case-insensitively, sorted", () => {
    expect(
      mergeFontLists(
        ["Arial", "verdana"],
        ["Verdana", " Zapf ", "", "arial", "Bahnschrift"],
      ),
    ).toEqual(["Arial", "Bahnschrift", "verdana", "Zapf"]);
  });
});
