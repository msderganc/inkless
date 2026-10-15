import { z } from "zod";
import { defaultDate, parseDateVar, renderDateVar } from "./datevars";
import { PLACEHOLDER_RE } from "./design";
import {
  type AmountFormat,
  expandPattern,
  formatAmount,
  groupValues,
  looksLikeGroup,
  parsePattern,
  PatternError,
} from "./pattern";

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
    /** Start and step may be fractional (1/4, 0.5) when shown as fractions or decimals. */
    start: z.number().finite().min(-1e9).max(1e9),
    step: z.number().finite().positive().max(1e9),
    count: z.number().int().positive(),
    /** Zero-pad numbers to this many digits (0 = no padding). */
    pad: z.number().int().min(0).max(12),
    prefix: z.string().max(50),
    suffix: z.string().max(50),
    /** Added later; older batches count in whole numbers. */
    style: z.enum(["number", "decimal", "fraction"]).default("number"),
    decimals: z.number().int().min(0).max(6).default(2),
    denominator: z.number().int().min(2).max(128).default(16),
  }),
  /** Brace pattern, e.g. "Bin {A-D}{1-5}" (see pattern.ts). */
  z.object({
    kind: z.literal("pattern"),
    pattern: z.string().max(200),
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
/** A batch as written (newer fields may be missing; defaults apply). */
export type BatchInput = z.input<typeof batchSpecSchema>;

/** One label's placeholder values, e.g. { n: "7" } or { name: "Hailey", qty: "2" }. */
export type BatchRecord = Record<string, string>;

export class BatchError extends Error {}

/**
 * Placeholder values for each label of a batch. `[null]` means a single label without
 * batch values. Throws BatchError for empty or oversize batches.
 */
export function batchRecords(spec: BatchInput): (BatchRecord | null)[] {
  return withIndex(rawRecords(spec));
}

/** Every batch also offers {i} (label number) and {total}, unless a column already uses them. */
function withIndex(recs: (BatchRecord | null)[]): (BatchRecord | null)[] {
  if (recs[0] === null) return recs;
  const total = String(recs.length);
  return recs.map((r, k) => ({ i: String(k + 1), total, ...r }));
}

/** Record key holding the current value of a range written in label text. */
const groupKey = (raw: string) => `#range:${raw.trim()}`;
/** Record key with a short description of the label (preview stepper, summary). */
const LABEL_KEY = "#label";

/**
 * Ranges and lists typed straight into label text ({1-10}, {A-D}, {1/4-2:1/4}, {red|blue}),
 * in order of first appearance. The same text in two places is one counter. Names that a
 * spreadsheet column or a date variable uses are not ranges.
 */
export function designRanges(
  texts: string[],
  columns: string[] = [],
): { key: string; values: string[] }[] {
  const taken = new Set(columns.map((c) => c.toLowerCase()));
  const out: { key: string; values: string[] }[] = [];
  for (const text of texts)
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      const key = m[1]!.trim();
      if (out.some((g) => g.key === key)) continue;
      if (taken.has(key.toLowerCase()) || parseDateVar(key)) continue;
      if (!looksLikeGroup(key)) continue;
      try {
        out.push({ key, values: groupValues(key) });
      } catch (e) {
        if (e instanceof PatternError) throw new BatchError(e.message);
        throw e;
      }
    }
  return out;
}

/**
 * The labels a print job makes: each batch record (or the single label) times every
 * combination of the ranges written in the label's text (last range changes fastest).
 */
export function jobRecords(
  spec: BatchInput,
  texts: string[],
): (BatchRecord | null)[] {
  const base = rawRecords(spec);
  const ranges = designRanges(texts, spec.kind === "csv" ? spec.columns : []);
  if (ranges.length === 0) return withIndex(base);
  const combos = ranges.reduce((n, g) => n * g.values.length, 1);
  const size = base.length * combos;
  if (size > MAX_BATCH)
    throw new BatchError(
      `That makes ${size} labels; a batch is limited to ${MAX_BATCH}.`,
    );
  const out: BatchRecord[] = [];
  for (const b of base) {
    for (let k = 0; k < combos; k++) {
      let rest = k;
      const rec: BatchRecord = { ...(b ?? {}) };
      const picked: string[] = [];
      for (let g = ranges.length - 1; g >= 0; g--) {
        const vals = ranges[g]!.values;
        const v = vals[rest % vals.length]!;
        rest = Math.floor(rest / vals.length);
        rec[groupKey(ranges[g]!.key)] = v;
        picked.unshift(v);
      }
      const head = b ? recordLabel(spec, b) : null;
      rec[LABEL_KEY] = [head, picked.join(" · ")].filter(Boolean).join(" · ");
      out.push(rec);
    }
  }
  return withIndex(out);
}

function rawRecords(spec: BatchInput): (BatchRecord | null)[] {
  switch (spec.kind) {
    case "none":
      return [null];
    case "sequence": {
      if (spec.count > MAX_BATCH)
        throw new BatchError(`A batch is limited to ${MAX_BATCH} labels`);
      const fmt: AmountFormat = {
        style: spec.style ?? "number",
        decimals: spec.decimals ?? 2,
        denominator: spec.denominator ?? 16,
        pad: spec.pad,
      };
      return Array.from({ length: spec.count }, (_, i) => ({
        n:
          spec.prefix +
          formatAmount(
            Math.round((spec.start + i * spec.step) * 1e9) / 1e9,
            fmt,
          ) +
          spec.suffix,
      }));
    }
    case "pattern": {
      if (!spec.pattern.trim()) throw new BatchError("Type a pattern first");
      try {
        const segs = parsePattern(spec.pattern);
        if (!segs.some((x) => "values" in x))
          throw new BatchError(
            "Add a range or list in braces, e.g. {1-10} or {A-D}",
          );
        return expandPattern(segs, MAX_BATCH).map((r) => {
          const rec: BatchRecord = { n: r.text };
          r.groups.forEach((g, k) => (rec[`g${k + 1}`] = g));
          return rec;
        });
      } catch (e) {
        if (e instanceof PatternError) throw new BatchError(e.message);
        throw e;
      }
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
  spec: BatchInput,
  rec: BatchRecord | null,
): string | null {
  if (!rec) return null;
  if (Object.hasOwn(rec, LABEL_KEY)) return rec[LABEL_KEY]!;
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
  // Count separators outside quotes: "Smith, John";Age is semicolon-separated.
  const unquoted = (line: string, d: string) => {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    return n;
  };
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    unquoted(firstLine, d) > unquoted(firstLine, best) ? d : best,
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
    const base = h.trim().replace(/[{}]/g, "").slice(0, 60) || `col${i + 1}`;
    let name = base;
    // Make duplicates unique without going over the 60-character column limit.
    for (let k = i + 1; seen.has(name.toLowerCase()); k++) {
      const suffix = `_${k}`;
      name = base.slice(0, 60 - suffix.length) + suffix;
    }
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
export const defaultDateFormat: DateFormatter = defaultDate;

/**
 * Fill placeholders: batch values ({n}, {name}, … matched case-insensitively) and date
 * variables ({today}, {today+30:m/d/yy}, {time}… see datevars.ts). Unknown placeholders are
 * left as typed.
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
    // A range typed in the label ({1-10}, {A-D}…) has this label's value in the record.
    const range = groupKey(key);
    if (record && Object.hasOwn(record, range)) return record[range]!;
    // A batch column with the same name ({date}, {year}…) wins, except {today} and {now}.
    const own = lower.get(key.toLowerCase());
    const date = parseDateVar(key);
    if (date && (own === undefined || /^(today|now)\b/i.test(key)))
      return renderDateVar(date, now, formatDate);
    return own ?? match;
  });
}
