import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDesign, newText } from "../design";
import { openDB } from "idb";
import { DEFAULT_SETTINGS, type Draft, newTemplate, Store } from "./store";

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

describe("upgrades across tabs", () => {
  it("reports when an older tab blocks the upgrade, then opens once it closes", async () => {
    const name = `blocked-${crypto.randomUUID()}`;
    // An old tab: version 1, with no handler to step aside.
    const old = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("templates", { keyPath: "id" }).createIndex(
          "updatedAt",
          "updatedAt",
        );
        db.createObjectStore("labelMap", { keyPath: "barcode" });
        db.createObjectStore("overrides", { keyPath: "labelId" });
        db.createObjectStore("settings", { keyPath: "key" });
      },
    });
    let blocked = 0;
    const opening = Store.open(name, () => {
      blocked++;
      old.close(); // the user closes the old tab
    });
    const s = await opening;
    expect(blocked).toBe(1);
    expect(await s.getDraft()).toBeUndefined();
    s.close();
  });

  it("closes itself so a future version's upgrade is not blocked", async () => {
    const name = `future-${crypto.randomUUID()}`;
    const current = await Store.open(name);
    let blocked = false;
    const next = await openDB(name, 3, { blocked: () => (blocked = true) });
    expect(blocked).toBe(false);
    next.close();
    current.close();
  });
});

describe("settings migration", () => {
  it("keeps older saved settings and defaults autoConnect to off", async () => {
    const raw = await openDB(dbName);
    await raw.put("settings", {
      key: "app",
      value: { offsetDots: 3, diagnostics: false },
    });
    raw.close();
    expect(await store.getSettings()).toEqual({
      offsetDots: 3,
      diagnostics: false,
      autoConnect: false,
    });
  });
});

describe("editor draft", () => {
  const draft = (): Draft => ({
    design: {
      ...emptyDesign("round-31"),
      elements: [newText(2, 10, 27, 10)],
    },
    batch: { kind: "list", items: ["A1", "B2"] },
    density: 4,
    copies: 2,
    template: { id: "t1", name: "Bins" },
    view: "print",
    zoom: 12,
    savedAt: 1,
  });

  it("round-trips and clears", async () => {
    expect(await store.getDraft()).toBeUndefined();
    const d = draft();
    await store.saveDraft(d);
    expect(await store.getDraft()).toEqual(d);
    await store.clearDraft();
    expect(await store.getDraft()).toBeUndefined();
  });

  it("rejects invalid drafts on save and ignores corrupt ones on load", async () => {
    await expect(store.saveDraft({ ...draft(), density: 9 })).rejects.toThrow();
    const raw = await openDB(dbName);
    await raw.put("drafts", { key: "editor", value: { design: "garbage" } });
    raw.close();
    expect(await store.getDraft()).toBeUndefined();
  });

  it("upgrades a version 1 database without losing templates", async () => {
    const name = `v1-${crypto.randomUUID()}`;
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        const t = db.createObjectStore("templates", { keyPath: "id" });
        t.createIndex("updatedAt", "updatedAt");
        db.createObjectStore("labelMap", { keyPath: "barcode" });
        db.createObjectStore("overrides", { keyPath: "labelId" });
        db.createObjectStore("settings", { keyPath: "key" });
      },
    });
    await v1.put("templates", sample("Kept"));
    v1.close();

    const upgraded = await Store.open(name);
    try {
      expect((await upgraded.listTemplates()).map((t) => t.name)).toEqual([
        "Kept",
      ]);
      await upgraded.saveDraft(draft());
      expect((await upgraded.getDraft())?.copies).toBe(2);
    } finally {
      upgraded.close();
    }
  });
});

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
