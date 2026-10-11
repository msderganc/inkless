import { z } from "zod";
import { BATCH_PLACEHOLDER } from "./design";

/** Upper bound on labels in one batch job (bounded queue requirement). */
export const MAX_BATCH = 500;

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
  z.object({ kind: z.literal("list"), items: z.array(z.string().max(500)) }),
]);

export type BatchSpec = z.infer<typeof batchSpecSchema>;

export class BatchError extends Error {}

function formatNumber(n: number, pad: number): string {
  const digits = Math.abs(n).toString().padStart(pad, "0");
  return n < 0 ? `-${digits}` : digits;
}

/**
 * Values for each label of a batch. `[null]` means a single label without substitution.
 * Throws BatchError for empty or oversize batches.
 */
export function batchValues(spec: BatchSpec): (string | null)[] {
  switch (spec.kind) {
    case "none":
      return [null];
    case "sequence": {
      if (spec.count > MAX_BATCH) throw new BatchError(`A batch is limited to ${MAX_BATCH} labels`);
      return Array.from(
        { length: spec.count },
        (_, i) => spec.prefix + formatNumber(spec.start + i * spec.step, spec.pad) + spec.suffix,
      );
    }
    case "list": {
      const items = spec.items.map((s) => s.trim()).filter((s) => s.length > 0);
      if (items.length === 0) throw new BatchError("The list is empty");
      if (items.length > MAX_BATCH) throw new BatchError(`A batch is limited to ${MAX_BATCH} labels`);
      return items;
    }
  }
}

/** Parse pasted text into list items, one per line. */
export function parseList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function substitute(text: string, value: string | null): string {
  return value === null ? text : text.split(BATCH_PLACEHOLDER).join(value);
}
