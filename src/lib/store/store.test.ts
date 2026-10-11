import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDesign, newText } from "../design";
import { DEFAULT_SETTINGS, newTemplate, Store } from "./store";

let store: Store;
let dbName: string;

beforeEach(async () => {
  dbName = `test-${crypto.randomUUID()}`;
  store = await Store.open(dbName);
});

afterEach(() => store.close());

const sample = (name = "Bins") =>
  newTemplate(
    name,
    { ...emptyDesign("rect-50x30"), elements: [newText(1, 1, 10, 5)] },
    { kind: "none" },
    3,
    1,
  );

describe("Store", () => {
  it("saves, lists newest first, and deletes templates", async () => {
    const a = { ...sample("A"), updatedAt: 1 };
    const b = { ...sample("B"), updatedAt: 2 };
    await store.saveTemplate(a);
    await store.saveTemplate(b);
    expect((await store.listTemplates()).map((t) => t.name)).toEqual([
      "B",
      "A",
    ]);
    await store.deleteTemplate(a.id);
    expect((await store.listTemplates()).map((t) => t.name)).toEqual(["B"]);
  });

  it("rejects invalid templates", async () => {
    await expect(
      store.saveTemplate({ ...sample(), density: 9 }),
    ).rejects.toThrow();
  });

  it("remembers RFID barcode → label", async () => {
    expect(await store.labelForBarcode("6972842743589")).toBeUndefined();
    await store.rememberBarcode("6972842743589", "rect-50x30");
    expect(await store.labelForBarcode("6972842743589")).toBe("rect-50x30");
    await store.rememberBarcode("", "rect-40x30");
    expect(await store.labelForBarcode("")).toBeUndefined();
  });

  it("settings default and persist", async () => {
    expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS);
    await store.saveSettings({
      offsetDots: -3,
      diagnostics: true,
      lastLabelId: "round-50",
    });
    expect(await store.getSettings()).toMatchObject({
      offsetDots: -3,
      lastLabelId: "round-50",
    });
    await expect(
      store.saveSettings({ offsetDots: 99, diagnostics: false }),
    ).rejects.toThrow();
  });

  it("overrides save and clear", async () => {
    await store.saveOverride("jewelry-30x70", {
      panels: [
        { y: 0, height: 18 },
        { y: 18, height: 18 },
      ],
    });
    expect(
      (await store.getOverrides())["jewelry-30x70"]?.panels?.[0].height,
    ).toBe(18);
    await store.clearOverride("jewelry-30x70");
    expect(await store.getOverrides()).toEqual({});
  });

  it("round-trips a backup into a fresh database", async () => {
    await store.saveTemplate(sample());
    await store.rememberBarcode("123", "round-31");
    await store.saveOverride("cable-25x78", { widthMm: 26 });
    await store.saveSettings({ offsetDots: 2, diagnostics: false });
    const backup = JSON.parse(
      JSON.stringify(await store.exportBackup()),
    ) as unknown;

    const other = await Store.open(`${dbName}-restore`);
    try {
      expect(await other.importBackup(backup)).toEqual({ templates: 1 });
      expect(await other.listTemplates()).toHaveLength(1);
      expect(await other.labelForBarcode("123")).toBe("round-31");
      expect((await other.getOverrides())["cable-25x78"]).toEqual({
        widthMm: 26,
      });
      expect((await other.getSettings()).offsetDots).toBe(2);
    } finally {
      other.close();
    }
  });

  it("rejects foreign or malformed backups without writing", async () => {
    await expect(store.importBackup({ app: "other" })).rejects.toThrow();
    const good = await store.exportBackup();
    await expect(
      store.importBackup({
        ...good,
        templates: [{ ...sample(), design: { version: 2 } }],
      }),
    ).rejects.toThrow();
    expect(await store.listTemplates()).toHaveLength(0);
  });
});
