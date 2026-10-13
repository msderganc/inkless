"use client";

import { CircleStop, FileSpreadsheet, Printer } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  BatchError,
  batchRecords,
  type BatchInput,
  type BatchSpec,
  batchSpecSchema,
  MAX_BATCH,
  MAX_FILE_NAME_CHARS,
  parseCsv,
  parseList,
  recordLabel,
} from "~/lib/batch";
import {
  formatAmount,
  inferFormat,
  LIST_PRESETS,
  parseAmount,
  PATTERN_EXAMPLES,
} from "~/lib/pattern";
import { MAX_COPIES } from "~/lib/printer/session";
import { IconButton } from "./IconButton";

interface Props {
  batch: BatchSpec;
  onBatch: (b: BatchSpec) => void;
  copies: number;
  onCopies: (n: number) => void;
  density: number;
  onDensity: (n: number) => void;
  usesPlaceholder: boolean;
}

const field = "rounded border border-neutral-300 px-2 py-1";

const BATCH_KINDS = [
  ["none", "Single"],
  ["sequence", "Numbers"],
  ["list", "List"],
  ["pattern", "Pattern"],
  ["csv", "Spreadsheet"],
] as const;

const NEW_SEQUENCE: BatchSpec = {
  kind: "sequence",
  start: 1,
  step: 1,
  count: 10,
  pad: 0,
  prefix: "",
  suffix: "",
  style: "number",
  decimals: 2,
  denominator: 16,
};

type Summary =
  | { count: number; first?: string | null; last?: string | null }
  | { error: string };

function summarize(batch: BatchSpec): Summary {
  try {
    const v = batchRecords(batch);
    if (v[0] === null) return { count: 1 };
    return {
      count: v.length,
      first: recordLabel(batch, v[0]!),
      last: recordLabel(batch, v[v.length - 1]!),
    };
  } catch (e) {
    return { error: e instanceof BatchError ? e.message : String(e) };
  }
}

/** Copies, darkness and batch options (the Print tab). */
export function PrintSettings(p: Props) {
  const [listText, setListText] = useState(
    p.batch.kind === "list" ? p.batch.items.join("\n") : "",
  );
  const [patternText, setPatternText] = useState(
    p.batch.kind === "pattern" ? p.batch.pattern : "Bin {A-D}{1-5}",
  );
  const [csvError, setCsvError] = useState<string>();
  const csvInput = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => summarize(p.batch), [p.batch]);

  const loadCsv = async (file: File) => {
    setCsvError(undefined);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new BatchError("That file is larger than 2 MB.");
      const { columns, rows } = parseCsv(await file.text());
      p.onBatch({
        kind: "csv",
        fileName: file.name.slice(0, MAX_FILE_NAME_CHARS),
        columns,
        rows,
      });
    } catch (e) {
      setCsvError(
        e instanceof BatchError
          ? e.message
          : "That file could not be read as CSV.",
      );
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col text-xs text-neutral-600">
          Copies of each
          <input
            className={`${field} w-20 text-sm text-neutral-900`}
            type="number"
            min={1}
            max={MAX_COPIES}
            value={p.copies}
            onChange={(e) =>
              p.onCopies(
                Math.min(
                  MAX_COPIES,
                  Math.max(1, Math.round(Number(e.target.value) || 1)),
                ),
              )
            }
          />
        </label>
        <label className="flex flex-col text-xs text-neutral-600">
          <span>
            Darkness{" "}
            <span className="font-medium text-neutral-900 tabular-nums">
              {p.density} of 5
            </span>
          </span>
          <input
            type="range"
            min={1}
            max={5}
            value={p.density}
            aria-valuetext={`${p.density} of 5`}
            onChange={(e) => p.onDensity(Number(e.target.value))}
          />
        </label>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 text-xs text-neutral-600">Batch</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {BATCH_KINDS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="radio"
                name="batch"
                checked={p.batch.kind === k}
                onChange={() =>
                  k === "csv"
                    ? csvInput.current?.click()
                    : p.onBatch(
                        k === "none"
                          ? { kind: "none" }
                          : k === "sequence"
                            ? NEW_SEQUENCE
                            : k === "pattern"
                              ? { kind: "pattern", pattern: patternText }
                              : { kind: "list", items: parseList(listText) },
                      )
                }
              />
              {label}
            </label>
          ))}
        </div>

        {p.batch.kind === "sequence" && (
          <SequenceFields b={p.batch} onChange={p.onBatch} />
        )}
        {p.batch.kind === "list" && (
          <div className="space-y-1">
            <select
              className={`${field} w-full text-sm`}
              aria-label="Fill the list with a preset"
              value=""
              onChange={(e) => {
                const preset = LIST_PRESETS[Number(e.target.value)];
                if (!preset) return;
                const text = preset.items.join("\n");
                setListText(text);
                p.onBatch({ kind: "list", items: preset.items });
              }}
            >
              <option value="">Fill with a preset list…</option>
              {LIST_PRESETS.map((l, i) => (
                <option key={l.name} value={i}>
                  {l.name}
                </option>
              ))}
            </select>
            <textarea
              className={`${field} min-h-24 w-full font-mono text-xs`}
              placeholder="One value per line"
              value={listText}
              onChange={(e) => {
                setListText(e.target.value);
                p.onBatch({ kind: "list", items: parseList(e.target.value) });
              }}
            />
          </div>
        )}
        {p.batch.kind === "pattern" && (
          <div className="space-y-1.5">
            <input
              className={`${field} w-full font-mono text-sm`}
              aria-label="Pattern"
              placeholder="e.g. Bin {A-D}{1-5}"
              maxLength={200}
              value={patternText}
              onChange={(e) => {
                setPatternText(e.target.value);
                p.onBatch({ kind: "pattern", pattern: e.target.value });
              }}
            />
            <div className="flex flex-wrap gap-1">
              {PATTERN_EXAMPLES.map((x) => (
                <button
                  key={x.pattern}
                  type="button"
                  title={x.note}
                  className="rounded-full border border-neutral-300 px-2 py-0.5 font-mono text-[11px] hover:bg-neutral-100"
                  onClick={() => {
                    setPatternText(x.pattern);
                    p.onBatch({ kind: "pattern", pattern: x.pattern });
                  }}
                >
                  {x.pattern}
                </button>
              ))}
            </div>
            <details className="text-xs text-neutral-600">
              <summary className="cursor-pointer">Pattern help</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  <code>{"{1-10}"}</code> numbers · <code>{"{01-10}"}</code>{" "}
                  zero-padded · <code>{"{10-1}"}</code> counts down
                </li>
                <li>
                  <code>{"{0-100:5}"}</code> step 5 ·{" "}
                  <code>{"{1/4-2:1/4}"}</code> fractions ·{" "}
                  <code>{"{0.5-3:0.5}"}</code> decimals
                </li>
                <li>
                  <code>{"{A-Z}"}</code> letters · <code>{"{AA-AF}"}</code> ·{" "}
                  <code>{"{1-12:ROMAN}"}</code> or <code>:roman</code>
                </li>
                <li>
                  <code>{"{red|green|blue}"}</code> a list ·{" "}
                  <code>{"{-5..5}"}</code> negatives
                </li>
                <li>
                  Several groups make every combination (the last changes
                  fastest). On the label, <code>{"{n}"}</code> is the whole
                  result; <code>{"{g1}"}</code>, <code>{"{g2}"}</code>… are each
                  group.
                </li>
              </ul>
            </details>
          </div>
        )}

        <input
          ref={csvInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void loadCsv(file);
          }}
        />
        {p.batch.kind === "csv" && (
          <div className="space-y-1 rounded border border-neutral-200 p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate" title={p.batch.fileName}>
                {p.batch.fileName} · {p.batch.rows.length} rows
              </span>
              <IconButton
                icon={FileSpreadsheet}
                label="Choose another CSV file"
                size="sm"
                onClick={() => csvInput.current?.click()}
              />
            </div>
            <p className="text-neutral-600">Use these in any text box:</p>
            <div className="flex flex-wrap gap-1">
              {p.batch.columns.map((c) => (
                <code key={c} className="rounded bg-neutral-100 px-1">
                  {"{"}
                  {c}
                  {"}"}
                </code>
              ))}
            </div>
          </div>
        )}
        {csvError && <p className="text-xs text-red-700">{csvError}</p>}

        {p.batch.kind !== "none" && !p.usesPlaceholder && (
          <p className="text-xs text-amber-700">
            {p.batch.kind === "csv"
              ? "Add a column placeholder like {" +
                (p.batch.columns[0] ?? "name") +
                "} to a text box."
              : "Add {n} to a text box to print the batch value on each label."}
          </p>
        )}
        {"error" in summary ? (
          <p className="text-xs text-red-700">{summary.error}</p>
        ) : (
          summary.first != null && (
            <p className="text-xs text-neutral-500">
              {summary.count} labels: “{summary.first}” … “{summary.last}” (max{" "}
              {MAX_BATCH})
            </p>
          )
        )}
        <p className="text-xs text-neutral-500">
          In text: <code>{"{n}"}</code> batch value, <code>{"{i}"}</code> label
          number, <code>{"{total}"}</code> labels in the batch. Dates and times:
          use Insert variable on a text item.
        </p>
      </fieldset>
    </section>
  );
}

interface BarProps {
  batch: BatchSpec;
  copies: number;
  state: string;
  progress?: { done: number; total: number };
  onPrint: () => void;
  onCancel: () => void;
  onConnect: () => void;
  lastResult?: string;
  error?: string;
}

/** Always-visible Print button with the label count, why it can't print, and progress. */
export function PrintBar(p: BarProps) {
  const summary = useMemo(() => summarize(p.batch), [p.batch]);
  const printing = p.state === "printing" || p.state === "cancelling";
  const labels = "count" in summary ? summary.count * p.copies : 0;
  const blocked =
    "error" in summary
      ? summary.error
      : p.state === "disconnected"
        ? "Connect the printer to print."
        : p.state === "connecting"
          ? "Connecting to the printer…"
          : p.state === "error"
            ? (p.error ?? "The printer reported a problem.")
            : undefined;

  return (
    <div className="space-y-2">
      {printing ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-on-accent inline-flex h-10 items-center gap-2 rounded border border-amber-500 bg-amber-500 px-4 font-medium hover:bg-amber-600 disabled:opacity-50"
            onClick={p.onCancel}
            disabled={p.state === "cancelling"}
          >
            <CircleStop size={18} aria-hidden />
            {p.state === "cancelling" ? "Stopping…" : "Cancel"}
          </button>
          {p.progress && (
            <div className="flex flex-1 flex-col gap-1">
              <progress
                className="h-2 w-full"
                max={p.progress.total}
                value={p.progress.done}
                aria-label="Print progress"
              />
              <span className="text-xs text-neutral-600 tabular-nums">
                {p.progress.done} of {p.progress.total}
              </span>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="text-on-accent inline-flex h-11 w-full items-center justify-center gap-2 rounded border border-sky-600 bg-sky-600 px-4 text-base font-semibold hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!!blocked || p.state !== "ready"}
          onClick={p.onPrint}
        >
          <Printer size={20} aria-hidden />
          Print {labels} label{labels === 1 ? "" : "s"}
        </button>
      )}
      {!printing && blocked && (
        <p
          className="flex items-center gap-2 text-xs text-neutral-600"
          role="status"
        >
          <span className="flex-1">{blocked}</span>
          {p.state === "disconnected" && (
            <button
              type="button"
              className="rounded border border-sky-600 px-2 py-0.5 text-sky-700 hover:bg-sky-50"
              onClick={p.onConnect}
            >
              Connect
            </button>
          )}
        </p>
      )}
      {p.lastResult && (
        <p className="text-sm text-neutral-700" role="status">
          {p.lastResult}
        </p>
      )}
    </div>
  );
}

type Sequence = Extract<BatchInput, { kind: "sequence" }>;

/** Numbers: start/step accept 1/4, 1 1/4 or 0.5; shown as whole numbers, decimals or fractions. */
function SequenceFields({
  b,
  onChange,
}: {
  b: Sequence;
  onChange: (b: BatchSpec) => void;
}) {
  const style = b.style ?? "number";
  const fmt = {
    style,
    decimals: b.decimals ?? 2,
    denominator: b.denominator ?? 16,
    pad: b.pad,
  };
  const [startText, setStartText] = useState(formatAmount(b.start, fmt));
  const [stepText, setStepText] = useState(formatAmount(b.step, fmt));
  const [bad, setBad] = useState<string>();
  const update = (patch: Partial<Sequence>) =>
    onChange(batchSpecSchema.parse({ ...b, ...patch }));

  /** Typing "1/4" or "0.25" switches to fractions/decimals automatically. */
  const amountField = (label: string, key: "start" | "step") => (
    <label className="flex flex-col text-xs text-neutral-600">
      {label}
      <input
        className={`${field} w-20 text-sm text-neutral-900`}
        value={key === "start" ? startText : stepText}
        onChange={(e) => {
          const text = e.target.value;
          (key === "start" ? setStartText : setStepText)(text);
          const a = parseAmount(text);
          if (!a || (key === "step" && a.value <= 0)) {
            setBad(`${label} must be a number like 2, 0.5 or 1/4.`);
            return;
          }
          setBad(undefined);
          const other = parseAmount(key === "start" ? stepText : startText);
          const f = inferFormat(other ? [a, other] : [a]);
          update({
            [key]: a.value,
            ...(f.style !== "number"
              ? {
                  style: f.style,
                  decimals: f.decimals || (b.decimals ?? 2),
                  denominator: f.denominator,
                }
              : {}),
          });
        }}
      />
    </label>
  );
  const int = (label: string, key: "count" | "pad", min: number) => (
    <label className="flex flex-col text-xs text-neutral-600">
      {label}
      <input
        className={`${field} w-16 text-sm text-neutral-900`}
        type="number"
        min={min}
        value={b[key]}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value));
          if (Number.isFinite(v)) update({ [key]: Math.max(min, v) });
        }}
      />
    </label>
  );
  const text = (label: string, key: "prefix" | "suffix") => (
    <label className="flex flex-col text-xs text-neutral-600">
      {label}
      <input
        className={`${field} w-20 text-sm text-neutral-900`}
        maxLength={50}
        value={b[key]}
        onChange={(e) => update({ [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {text("Prefix", "prefix")}
        {amountField("Start", "start")}
        {amountField("Step", "step")}
        {int("Count", "count", 1)}
        {text("Suffix", "suffix")}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-neutral-600">
          Show as
          <select
            className={`${field} text-sm text-neutral-900`}
            value={style}
            onChange={(e) =>
              update({ style: e.target.value as Sequence["style"] })
            }
          >
            <option value="number">Whole numbers</option>
            <option value="decimal">Decimals</option>
            <option value="fraction">Fractions (1 1/4)</option>
          </select>
        </label>
        {style === "number" && int("Digits", "pad", 0)}
        {style === "decimal" && (
          <label className="flex flex-col text-xs text-neutral-600">
            Places
            <input
              className={`${field} w-16 text-sm text-neutral-900`}
              type="number"
              min={0}
              max={6}
              value={b.decimals ?? 2}
              onChange={(e) =>
                update({
                  decimals: Math.min(
                    6,
                    Math.max(0, Math.round(Number(e.target.value) || 0)),
                  ),
                })
              }
            />
          </label>
        )}
        {style === "fraction" && (
          <label className="flex flex-col text-xs text-neutral-600">
            Round to
            <select
              className={`${field} text-sm text-neutral-900`}
              value={b.denominator ?? 16}
              onChange={(e) => update({ denominator: Number(e.target.value) })}
            >
              {[2, 4, 8, 16, 32, 64].map((d) => (
                <option key={d} value={d}>
                  1/{d}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {bad && <p className="text-xs text-red-700">{bad}</p>}
    </div>
  );
}
