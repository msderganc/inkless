import { z } from "zod";
import { PLACEHOLDER_RE, TODAY_RE } from "./design";

/** Upper bound on labels in one batch job (bounded queue requirement). */
export const MAX_BATCH = 500;
export const MAX_CSV_COLUMNS = 50;
export const MAX_FILE_NAME_CHARS = 200;
/** Longest cell / list item (matches the schema below). */
export const MAX_CELL_CHARS = 500;

export const batchSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("sequence"),
    start: z.number().int(),
    step: z.number().int().positive(),
    count: z.number().int().positive(),
    /** Zero-pad numbers to this many digits (0 = no padding). */
    pad: z.number().int().min(0).max(12),
    prefix: z.string().max(50),
    suffix: z.string().max(50),
  }),
  z.object({
    kind: z.literal("list"),
    items: z.array(z.string().max(MAX_CELL_CHARS)),
  }),
  /** Spreadsheet rows: each column is a {placeholder}; each row is one label. */
  z.object({
    kind: z.literal("csv"),
    fileName: z.string().max(MAX_FILE_NAME_CHARS),
    columns: z.array(z.string().min(1).max(60)).min(1).max(MAX_CSV_COLUMNS),
    rows: z.array(z.array(z.string().max(MAX_CELL_CHARS))).max(MAX_BATCH),
  }),
]);

export type BatchSpec = z.infer<typeof batchSpecSchema>;

/** One label's placeholder values, e.g. { n: "7" } or { name: "Hailey", qty: "2" }. */
export type BatchRecord = Record<string, string>;

export class BatchError extends Error {}

function formatNumber(n: number, pad: number): string {
  const digits = Math.abs(n).toString().padStart(pad, "0");
  return n < 0 ? `-${digits}` : digits;
}

/**
 * Placeholder values for each label of a batch. `[null]` means a single label without
 * batch values. Throws BatchError for empty or oversize batches.
 */
export function batchRecords(spec: BatchSpec): (BatchRecord | null)[] {
  switch (spec.kind) {
    case "none":
      return [null];
    case "sequence": {
      if (spec.count > MAX_BATCH)
        throw new BatchError(`A batch is limited to ${MAX_BATCH} labels`);
      return Array.from({ length: spec.count }, (_, i) => ({
        n:
          spec.prefix +
          formatNumber(spec.start + i * spec.step, spec.pad) +
          spec.suffix,
      }));
    }
    case "list": {
      const items = spec.items.map((s) => s.trim()).filter((s) => s.length > 0);
      if (items.length === 0) throw new BatchError("The list is empty");
      if (items.length > MAX_BATCH)
        throw new BatchError(`A batch is limited to ${MAX_BATCH} labels`);
      return items.map((n) => ({ n }));
    }
    case "csv": {
      const rows = spec.rows.filter((r) => r.some((c) => c.trim() !== ""));
      if (rows.length === 0)
        throw new BatchError("The spreadsheet has no rows");
      if (rows.length > MAX_BATCH)
        throw new BatchError(`A batch is limited to ${MAX_BATCH} labels`);
      return rows.map((row, i) => {
        const rec: BatchRecord = { n: String(i + 1) };
        spec.columns.forEach((col, c) => (rec[col] = row[c] ?? ""));
        return rec;
      });
    }
  }
}

/** Short description of a record for the preview stepper and batch summary. */
export function recordLabel(
  spec: BatchSpec,
  rec: BatchRecord | null,
): string | null {
  if (!rec) return null;
  if (spec.kind === "csv") return rec[spec.columns[0]!] ?? rec.n ?? null;
  return rec.n ?? null;
}

/**
 * Parse CSV text (comma, semicolon or tab separated; RFC 4180 quotes). The first row holds the
 * column names, which become {placeholders}. Blank or duplicate names are made unique.
 */
export function parseCsv(text: string): {
  columns: string[];
  rows: string[][];
} {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );

  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) throw new BatchError("The file is empty");
  const header = nonEmpty[0]!.slice(0, MAX_CSV_COLUMNS);
  const seen = new Set<string>();
  const columns = header.map((h, i) => {
    let name = h.trim().replace(/[{}]/g, "").slice(0, 60) || `col${i + 1}`;
    while (seen.has(name.toLowerCase())) name = `${name}_${i + 1}`;
    seen.add(name.toLowerCase());
    return name;
  });
  const rows = nonEmpty
    .slice(1)
    // Cells are capped to the schema limit so drafts and templates always validate.
    .map((r) =>
      columns.map((_, c) => (r[c] ?? "").trim().slice(0, MAX_CELL_CHARS)),
    );
  if (rows.length > MAX_BATCH)
    throw new BatchError(
      `The file has ${rows.length} rows; a batch is limited to ${MAX_BATCH} labels`,
    );
  return { columns, rows };
}

/** Parse pasted text into list items, one per line. */
export function parseList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim().slice(0, MAX_CELL_CHARS))
    .filter((s) => s.length > 0);
}

export type DateFormatter = (d: Date) => string;

/** Short local date, e.g. 12/10/2026 in Australia. */
export const defaultDateFormat: DateFormatter = (d) =>
  d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * Fill placeholders: batch values ({n}, {name}, … matched case-insensitively), {today}, and
 * {today+N} / {today-N} (N days). Unknown placeholders are left as typed.
 */
export function substitute(
  text: string,
  record: BatchRecord | null,
  now: Date = new Date(),
  formatDate: DateFormatter = defaultDateFormat,
): string {
  // A Map, not an object: {constructor} or {__proto__} must not resolve to built-ins.
  const lower = new Map(
    Object.entries(record ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return text.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
    const key = rawKey.trim();
    const date = TODAY_RE.exec(key);
    if (date) {
      const d = new Date(now);
      if (date[1])
        d.setDate(d.getDate() + (date[1] === "-" ? -1 : 1) * Number(date[2]));
      return formatDate(d);
    }
    return lower.get(key.toLowerCase()) ?? match;
  });
}
