import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDesign, newText } from "../design";
import { openDB } from "idb";
import {
  DB_VERSION,
  DEFAULT_SETTINGS,
  type Draft,
  newTemplate,
  Store,
  USAGE_LIMIT,
} from "./store";

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
    const next = await openDB(name, DB_VERSION + 1, {
      blocked: () => (blocked = true),
    });
    expect(blocked).toBe(false);
    next.close();
    current.close();
  });
});

describe("AI settings", () => {
  it("stores keys locally and never puts them in backups", async () => {
    expect((await store.getAiSettings()).provider).toBe("anthropic");
    await store.saveAiSettings({
      provider: "openai",
      anthropicKey: "sk-ant-secret",
      openaiKey: "sk-openai-secret",
      anthropicModel: "claude-opus-5-5",
      openaiModel: "gpt-5.5",
    });
    expect((await store.getAiSettings()).openaiKey).toBe("sk-openai-secret");
    const backup = JSON.stringify(await store.exportBackup());
    expect(backup).not.toContain("sk-ant-secret");
    expect(backup).not.toContain("sk-openai-secret");
  });

  it("replaces an old-format host id that was never registered", async () => {
    await store.saveChatgptAuth({ hostId: "abcdefghijkl", scopes: [] });
    expect((await store.getChatgptAuth()).hostId).toMatch(
      /^urn:uuid:[0-9a-f-]{36}$/,
    );
  });

  it("keeps the ChatGPT sign-in local and out of backups", async () => {
    const fresh = await store.getChatgptAuth();
    expect(fresh.hostId).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(fresh.hostId.length).toBeGreaterThanOrEqual(8);
    expect((await store.getChatgptAuth()).hostId).toBe(fresh.hostId);
    await store.saveChatgptAuth({
      ...fresh,
      refreshToken: "rt-secret",
      scopes: ["x"],
    });
    expect((await store.getChatgptAuth()).refreshToken).toBe("rt-secret");
    expect(JSON.stringify(await store.exportBackup())).not.toContain(
      "rt-secret",
    );

    const pending = { state: "s", nonce: "n", verifier: "v", createdAt: 1 };
    await store.savePendingSignIn(pending);
    expect(await store.getPendingSignIn()).toEqual(pending);
    await store.savePendingSignIn(undefined);
    expect(await store.getPendingSignIn()).toBeUndefined();
  });
});

describe("AI usage log", () => {
  const use = (at: number) => ({
    at,
    provider: "anthropic" as const,
    billing: "api-key" as const,
    model: "claude-opus-5-5",
    inputTokens: 1,
    outputTokens: 2,
    costUsd: 0.001,
    prompt: `p${at}`,
    kind: "vector" as const,
  });

  it("lists newest first, prunes the oldest beyond the limit, clears, and isn't backed up", async () => {
    await store.logUsage(use(2));
    await store.logUsage(use(1));
    await store.logUsage(use(3));
    expect((await store.listUsage()).map((e) => e.at)).toEqual([3, 2, 1]);
    expect(JSON.stringify(await store.exportBackup())).not.toContain("p2");
    await store.clearUsage();
    expect(await store.listUsage()).toEqual([]);
  });

  it("keeps at most USAGE_LIMIT entries", async () => {
    for (let i = 0; i < USAGE_LIMIT + 3; i++) await store.logUsage(use(i));
    const all = await store.listUsage();
    expect(all).toHaveLength(USAGE_LIMIT);
    expect(all.at(-1)!.at).toBe(3);
  }, 30_000);
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
    zoomFit: false,
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
      await upgraded.logUsage({
        at: 1,
        provider: "openai",
        billing: "chatgpt-plan",
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
        prompt: "x",
        kind: "vector",
      });
      expect(await upgraded.listUsage()).toHaveLength(1);
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
