import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { z } from "zod";
import {
  type ChatgptAuth,
  chatgptAuthSchema,
  newChatgptAuth,
  type PendingSignIn,
  pendingSignInSchema,
} from "../ai/chatgpt-auth";
import { DEFAULT_MODELS, DEFAULT_OPENAI_IMAGE_MODEL } from "../ai/models";
import { type UsageEntry } from "../ai/pricing";
import { batchSpecSchema, type BatchSpec } from "../batch";
import {
  designSchema,
  type Design,
  MAX_IMAGE_SRC_CHARS,
  MAX_SVG_CHARS,
} from "../design";
import { sanitizeSvg } from "../svg";

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

/** Saved "My icons" limit. */
export const MAX_SAVED_ICONS = 500;

/** Icon library categories of a saved icon (older saves have none). */
const savedCategories = z
  .array(z.string().regex(/^[a-z0-9-]{1,40}$/))
  .max(10)
  .default([]);

/** An icon the user saved for reuse (AI-generated SVG or image-model PNG). */
export const savedIconSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    createdAt: z.number(),
    type: z.literal("svg"),
    data: z.string().min(1).max(MAX_SVG_CHARS),
    categories: savedCategories,
  }),
  z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    createdAt: z.number(),
    type: z.literal("png"),
    data: z
      .string()
      .max(MAX_IMAGE_SRC_CHARS)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
    categories: savedCategories,
  }),
]);
export type SavedIcon = z.infer<typeof savedIconSchema>;

export const backupSchema = z.object({
  app: z.literal(EXPORT_APP),
  schema: z.literal(EXPORT_SCHEMA),
  exportedAt: z.string(),
  templates: z.array(templateSchema).max(10_000),
  labelMap: z.record(z.string(), z.string()),
  overrides: z.record(z.string(), overrideSchema),
  settings: settingsSchema,
  /** Saved icons (added later; older backups have none). */
  icons: z.array(savedIconSchema).max(MAX_SAVED_ICONS).default([]),
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
  /** AI provider keys and models (DB version 3). Never included in backups. */
  /** Validated per key on read: "ai" (AiSettings), "chatgpt" (auth), "chatgpt-pending". */
  secrets: { key: string; value: { key: string; value: unknown } };
  /** AI usage log (DB version 4). Local only; never exported. */
  usage: { key: number; value: UsageEntry; indexes: { at: number } };
  /** Saved "My icons" (DB version 5). Included in backups. */
  icons: { key: string; value: SavedIcon; indexes: { createdAt: number } };
}

export const aiSettingsSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  anthropicKey: z.string().max(500),
  openaiKey: z.string().max(500),
  anthropicModel: z.string().min(1).max(100),
  openaiModel: z.string().min(1).max(100),
  // Added later: defaults keep older saved settings valid.
  openaiImageModel: z
    .string()
    .min(1)
    .max(100)
    .default(DEFAULT_OPENAI_IMAGE_MODEL),
  /** OpenAI only: "vector" (SVG from a text model) or "image" (image model, converted to 1-bit). */
  iconStyle: z.enum(["vector", "image"]).default("vector"),
  /** OpenAI: pay with an API key, or with the ChatGPT plan via "Sign in with ChatGPT". */
  openaiAuth: z.enum(["key", "chatgpt"]).default("key"),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "anthropic",
  anthropicKey: "",
  openaiKey: "",
  anthropicModel: DEFAULT_MODELS.anthropic,
  openaiModel: DEFAULT_MODELS.openai,
  openaiImageModel: DEFAULT_OPENAI_IMAGE_MODEL,
  iconStyle: "vector",
  openaiAuth: "key",
};

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
export const DB_VERSION = 5;
/** Usage log entries kept (oldest are pruned). */
export const USAGE_LIMIT = 2000;

export class Store {
  private constructor(private readonly db: IDBPDatabase<LabelDb>) {}

  /**
   * Open the database. An upgrade waits until every other connection (another tab or window still
   * running an older version) has closed; `onBlocked` is called while that is happening so the UI
   * can say so. This connection closes itself whenever a newer version needs to upgrade, so this
   * version never blocks a future one.
   */
  static async open(name = DB_NAME, onBlocked?: () => void): Promise<Store> {
    const opened: { db?: IDBPDatabase<LabelDb> } = {};
    const db = await openDB<LabelDb>(name, DB_VERSION, {
      blocked: () => onBlocked?.(),
      blocking: () => opened.db?.close(),
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
        if (oldVersion < 3) db.createObjectStore("secrets", { keyPath: "key" });
        if (oldVersion < 4) {
          const u = db.createObjectStore("usage", { autoIncrement: true });
          u.createIndex("at", "at");
        }
        if (oldVersion < 5) {
          const i = db.createObjectStore("icons", { keyPath: "id" });
          i.createIndex("createdAt", "createdAt");
        }
      },
    });
    opened.db = db;
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

  /** Saved icons, newest first. Invalid rows are skipped. */
  async listIcons(): Promise<SavedIcon[]> {
    const rows = await this.db.getAllFromIndex("icons", "createdAt");
    return rows.reverse().flatMap((r) => {
      const p = savedIconSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  }

  /** Save an icon (SVGs are re-sanitised). Throws when the collection is full. */
  async saveIcon(icon: z.input<typeof savedIconSchema>): Promise<void> {
    const clean = savedIconSchema.parse(
      icon.type === "svg" ? { ...icon, data: sanitizeSvg(icon.data) } : icon,
    );
    const tx = this.db.transaction("icons", "readwrite");
    const exists = await tx.store.get(clean.id);
    if (!exists && (await tx.store.count()) >= MAX_SAVED_ICONS) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new Error(
        `My icons is full (${MAX_SAVED_ICONS}). Delete some to save more.`,
      );
    }
    await tx.store.put(clean);
    await tx.done;
  }

  async deleteIcon(id: string): Promise<void> {
    await this.db.delete("icons", id);
  }

  /** "Sign in with ChatGPT" tokens (created with a fresh host id if none yet). */
  async getChatgptAuth(): Promise<ChatgptAuth> {
    const row = await this.db.get("secrets", "chatgpt");
    const parsed = chatgptAuthSchema.safeParse(row?.value);
    if (parsed.success) {
      // Early builds used a non-URN host id, which OpenAI rejects. Nothing was ever
      // registered with it, so replace it.
      if (parsed.data.hostId.startsWith("urn:uuid:") || parsed.data.clientId)
        return parsed.data;
      const fixed = { ...parsed.data, hostId: newChatgptAuth().hostId };
      await this.saveChatgptAuth(fixed);
      return fixed;
    }
    const fresh = newChatgptAuth();
    await this.saveChatgptAuth(fresh);
    return fresh;
  }

  async saveChatgptAuth(value: ChatgptAuth): Promise<void> {
    await this.db.put("secrets", {
      key: "chatgpt",
      value: chatgptAuthSchema.parse(value),
    });
  }

  async getPendingSignIn(): Promise<PendingSignIn | undefined> {
    const parsed = pendingSignInSchema.safeParse(
      (await this.db.get("secrets", "chatgpt-pending"))?.value,
    );
    return parsed.success ? parsed.data : undefined;
  }

  async savePendingSignIn(value: PendingSignIn | undefined): Promise<void> {
    if (value) await this.db.put("secrets", { key: "chatgpt-pending", value });
    else await this.db.delete("secrets", "chatgpt-pending");
  }

  /** Record one AI request (bounded: keeps the newest USAGE_LIMIT entries). */
  async logUsage(entry: UsageEntry): Promise<void> {
    const tx = this.db.transaction("usage", "readwrite");
    await tx.store.add(entry);
    const count = await tx.store.count();
    if (count > USAGE_LIMIT) {
      let cursor = await tx.store.index("at").openCursor();
      for (let extra = count - USAGE_LIMIT; extra > 0 && cursor; extra--) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    await tx.done;
  }

  /** Usage entries, newest first. */
  async listUsage(): Promise<UsageEntry[]> {
    return (await this.db.getAllFromIndex("usage", "at")).reverse();
  }

  async clearUsage(): Promise<void> {
    await this.db.clear("usage");
  }

  /** AI settings, including API keys. Stored only in this browser; not exported. */
  async getAiSettings(): Promise<AiSettings> {
    const row = await this.db.get("secrets", "ai");
    const parsed = aiSettingsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : DEFAULT_AI_SETTINGS;
  }

  async saveAiSettings(value: z.input<typeof aiSettingsSchema>): Promise<void> {
    await this.db.put("secrets", {
      key: "ai",
      value: aiSettingsSchema.parse(value),
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
      icons: await this.listIcons(),
    };
  }

  /**
   * Merge a backup into the store in one transaction: templates and mappings with the same key
   * are replaced; nothing else is deleted. Throws a ZodError for invalid files.
   */
  async importBackup(raw: unknown): Promise<{ templates: number }> {
    const backup = backupSchema.parse(raw);
    // Saved SVGs come from a file: sanitise them again before storing.
    const icons = backup.icons.map((i) =>
      i.type === "svg" ? { ...i, data: sanitizeSvg(i.data) } : i,
    );
    const tx = this.db.transaction(
      ["templates", "labelMap", "overrides", "settings", "icons"],
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
      ...icons.map((i) => tx.objectStore("icons").put(i)),
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
