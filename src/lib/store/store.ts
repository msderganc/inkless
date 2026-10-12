import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { z } from "zod";
import { batchSpecSchema, type BatchSpec } from "../batch";
import { designSchema, type Design } from "../design";

/** Saved label template. */
export const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  design: designSchema,
  batch: batchSpecSchema,
  density: z.number().int().min(1).max(5),
  copies: z.number().int().min(1).max(100),
  updatedAt: z.number().int(),
});
export type Template = z.infer<typeof templateSchema>;

const bandSchema = z.object({
  y: z.number().min(0),
  height: z.number().positive(),
});
export const overrideSchema = z
  .object({
    widthMm: z.number().positive().max(50),
    heightMm: z.number().positive().max(200),
    cornerRadiusMm: z.number().min(0).max(25),
    panels: z.tuple([bandSchema, bandSchema]),
    flag: bandSchema,
    wrap: bandSchema,
  })
  .partial();

export const settingsSchema = z.object({
  /** Horizontal print calibration, dots (positive = shift right). */
  offsetDots: z.number().int().min(-16).max(16),
  lastLabelId: z.string().optional(),
  diagnostics: z.boolean(),
  /** Reconnect to the remembered printer on load and when it is plugged in. */
  autoConnect: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  offsetDots: 0,
  diagnostics: false,
  autoConnect: false,
};

export const EXPORT_APP = "label-printer";
export const EXPORT_SCHEMA = 1;

export const backupSchema = z.object({
  app: z.literal(EXPORT_APP),
  schema: z.literal(EXPORT_SCHEMA),
  exportedAt: z.string(),
  templates: z.array(templateSchema).max(10_000),
  labelMap: z.record(z.string(), z.string()),
  overrides: z.record(z.string(), overrideSchema),
  settings: settingsSchema,
});
export type Backup = z.infer<typeof backupSchema>;

interface LabelDb extends DBSchema {
  templates: { key: string; value: Template; indexes: { updatedAt: number } };
  /** RFID barcode → catalogue label id (V1). */
  labelMap: { key: string; value: { barcode: string; labelId: string } };
  overrides: {
    key: string;
    value: { labelId: string; override: z.infer<typeof overrideSchema> };
  };
  settings: { key: string; value: { key: string; value: Settings } };
  /** The editor's unsaved working state, restored on refresh (added in DB version 2). */
  drafts: { key: string; value: { key: string; value: Draft } };
}

/** Editor working state that survives a page refresh. */
export const draftSchema = z.object({
  design: designSchema,
  batch: batchSpecSchema,
  density: z.number().int().min(1).max(5),
  copies: z.number().int().min(1).max(100),
  /** Template the draft was loaded from or last saved as. */
  template: z.object({ id: z.string(), name: z.string() }).optional(),
  view: z.enum(["design", "print"]),
  zoom: z.number().min(1).max(40),
  savedAt: z.number().int(),
});
export type Draft = z.infer<typeof draftSchema>;

export const DB_NAME = "label-printer";
const DB_VERSION = 2;

export class Store {
  private constructor(private readonly db: IDBPDatabase<LabelDb>) {}

  static async open(name = DB_NAME): Promise<Store> {
    const db = await openDB<LabelDb>(name, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Additive migrations only, so existing templates and settings are kept.
        if (oldVersion < 1) {
          const t = db.createObjectStore("templates", { keyPath: "id" });
          t.createIndex("updatedAt", "updatedAt");
          db.createObjectStore("labelMap", { keyPath: "barcode" });
          db.createObjectStore("overrides", { keyPath: "labelId" });
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (oldVersion < 2) db.createObjectStore("drafts", { keyPath: "key" });
      },
    });
    return new Store(db);
  }

  close() {
    this.db.close();
  }

  /** The saved editor draft, or undefined if none or it no longer validates. */
  async getDraft(): Promise<Draft | undefined> {
    const row = await this.db.get("drafts", "editor");
    const parsed = draftSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : undefined;
  }

  async saveDraft(draft: Draft): Promise<void> {
    await this.db.put("drafts", {
      key: "editor",
      value: draftSchema.parse(draft),
    });
  }

  async clearDraft(): Promise<void> {
    await this.db.delete("drafts", "editor");
  }

  async listTemplates(): Promise<Template[]> {
    const all = await this.db.getAllFromIndex("templates", "updatedAt");
    return all.reverse();
  }

  async getTemplate(id: string): Promise<Template | undefined> {
    return this.db.get("templates", id);
  }

  async saveTemplate(t: Template): Promise<void> {
    await this.db.put("templates", templateSchema.parse(t));
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.db.delete("templates", id);
  }

  async labelForBarcode(barcode: string): Promise<string | undefined> {
    return (await this.db.get("labelMap", barcode))?.labelId;
  }

  async rememberBarcode(barcode: string, labelId: string): Promise<void> {
    if (!barcode) return;
    await this.db.put("labelMap", { barcode, labelId });
  }

  async getOverrides(): Promise<
    Record<string, z.infer<typeof overrideSchema>>
  > {
    const rows = await this.db.getAll("overrides");
    return Object.fromEntries(rows.map((r) => [r.labelId, r.override]));
  }

  async saveOverride(
    labelId: string,
    override: z.infer<typeof overrideSchema>,
  ): Promise<void> {
    await this.db.put("overrides", {
      labelId,
      override: overrideSchema.parse(override),
    });
  }

  async clearOverride(labelId: string): Promise<void> {
    await this.db.delete("overrides", labelId);
  }

  async getSettings(): Promise<Settings> {
    const row = await this.db.get("settings", "app");
    const parsed = settingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async saveSettings(value: z.input<typeof settingsSchema>): Promise<void> {
    await this.db.put("settings", {
      key: "app",
      value: settingsSchema.parse(value),
    });
  }

  async exportBackup(now = new Date()): Promise<Backup> {
    const labelRows = await this.db.getAll("labelMap");
    return {
      app: EXPORT_APP,
      schema: EXPORT_SCHEMA,
      exportedAt: now.toISOString(),
      templates: await this.listTemplates(),
      labelMap: Object.fromEntries(
        labelRows.map((r) => [r.barcode, r.labelId]),
      ),
      overrides: await this.getOverrides(),
      settings: await this.getSettings(),
    };
  }

  /**
   * Merge a backup into the store in one transaction: templates and mappings with the same key
   * are replaced; nothing else is deleted. Throws a ZodError for invalid files.
   */
  async importBackup(raw: unknown): Promise<{ templates: number }> {
    const backup = backupSchema.parse(raw);
    const tx = this.db.transaction(
      ["templates", "labelMap", "overrides", "settings"],
      "readwrite",
    );
    await Promise.all([
      ...backup.templates.map((t) => tx.objectStore("templates").put(t)),
      ...Object.entries(backup.labelMap).map(([barcode, labelId]) =>
        tx.objectStore("labelMap").put({ barcode, labelId }),
      ),
      ...Object.entries(backup.overrides).map(([labelId, override]) =>
        tx.objectStore("overrides").put({ labelId, override }),
      ),
      tx.objectStore("settings").put({ key: "app", value: backup.settings }),
      tx.done,
    ]);
    return { templates: backup.templates.length };
  }
}

export function newTemplate(
  name: string,
  design: Design,
  batch: BatchSpec,
  density: number,
  copies: number,
): Template {
  return {
    id: crypto.randomUUID(),
    name,
    design,
    batch,
    density,
    copies,
    updatedAt: Date.now(),
  };
}
