// @vitest-environment jsdom
// Regression tests for the independent review of ccbce5b.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { batchSpecSchema, jobRecords, parseCsv, substitute } from "./batch";
import { geometryProblem, resolveLabel } from "./labels";
import { MAX_SAVED_ICONS, Store } from "./store/store";

let store: Store;
beforeEach(async () => {
  store = await Store.open(`review-${crypto.randomUUID()}`);
});
afterEach(() => store.close());

const icon = (id: string) => ({
  id,
  name: id,
  createdAt: 1,
  type: "svg" as const,
  data: '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#000"/></svg>',
});

describe("CSV import (findings 9 and 10)", () => {
  it("ignores separators inside quoted headers when choosing the delimiter", () => {
    const { columns, rows } = parseCsv('"Smith, John";Age\n"Doe, Jane";30');
    expect(columns).toEqual(["Smith, John", "Age"]);
    expect(rows).toEqual([["Doe, Jane", "30"]]);
  });

  it("keeps deduplicated long headers within the 60-character limit", () => {
    const long = "x".repeat(60);
    const { columns, rows } = parseCsv(`${long},${long}\n1,2`);
    expect(columns[1]!.length).toBeLessThanOrEqual(60);
    expect(columns[0]).not.toBe(columns[1]);
    // The batch made from it validates (it used to fail).
    expect(() =>
      batchSpecSchema.parse({ kind: "csv", fileName: "f", columns, rows }),
    ).not.toThrow();
  });
});

describe("long lists in label text (additional 2)", () => {
  it("expands a 20-item list longer than 60 characters", () => {
    const list = `{${Array.from({ length: 20 }, (_, i) => `part${i}`).join("|")}}`;
    expect(list.length).toBeGreaterThan(60);
    const recs = jobRecords({ kind: "none" }, [list]);
    expect(recs).toHaveLength(20);
    expect(substitute(list, recs[19]!)).toBe("part19");
  });
});

describe("geometry overrides (additional 5)", () => {
  it("rejects bands outside the label when saving, and ignores stored bad ones", async () => {
    const bad = {
      panels: [
        { y: 0, height: 30 },
        { y: 1000, height: 30 },
      ] as [{ y: number; height: number }, { y: number; height: number }],
    };
    await expect(store.saveOverride("jewelry-30x70", bad)).rejects.toThrow(
      /doesn't fit/,
    );
    const spec = resolveLabel("jewelry-30x70", { "jewelry-30x70": bad })!;
    expect(geometryProblem(spec)).toBeUndefined(); // fell back to the catalogue geometry
    await store.saveOverride("jewelry-30x70", { cornerRadiusMm: 2 }); // a valid one still saves
  });
});

describe("backups (additional 1)", () => {
  it("refuses an import that would push My icons past the limit", async () => {
    for (let i = 0; i < MAX_SAVED_ICONS; i++)
      await store.saveIcon(icon(`a${i}`));
    const backup = await store.exportBackup();
    const extra = { ...backup, icons: [icon("new-one")] };
    await expect(store.importBackup(extra)).rejects.toThrow(/limit/);
    // Re-importing the same icons (same ids) is fine, and the export stays importable.
    await store.importBackup(backup);
    const again = await store.exportBackup();
    expect(again.icons).toHaveLength(MAX_SAVED_ICONS);
  }, 60_000);

  it("rejects a backup whose override doesn't fit its label", async () => {
    const backup = await store.exportBackup();
    await expect(
      store.importBackup({
        ...backup,
        overrides: {
          "jewelry-30x70": {
            panels: [
              { y: 0, height: 30 },
              { y: 1000, height: 30 },
            ],
          },
        },
      }),
    ).rejects.toThrow(/jewelry-30x70/);
  });
});
