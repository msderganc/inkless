"use client";

import { CircleStop, FileSpreadsheet, Printer } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  BatchError,
  batchRecords,
  type BatchSpec,
  MAX_BATCH,
  MAX_FILE_NAME_CHARS,
  parseCsv,
  parseList,
  recordLabel,
} from "~/lib/batch";
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
  state: string;
  progress?: { done: number; total: number };
  onPrint: () => void;
  onCancel: () => void;
  lastResult?: string;
}

const field = "rounded border border-neutral-300 px-2 py-1";

export function PrintPanel(p: Props) {
  const [listText, setListText] = useState(
    p.batch.kind === "list" ? p.batch.items.join("\n") : "",
  );
  const [csvError, setCsvError] = useState<string>();
  const csvInput = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => {
    try {
      const v = batchRecords(p.batch);
      if (v[0] === null) return { count: 1 };
      return {
        count: v.length,
        first: recordLabel(p.batch, v[0]!),
        last: recordLabel(p.batch, v[v.length - 1]!),
      };
    } catch (e) {
      return { error: e instanceof BatchError ? e.message : String(e) };
    }
  }, [p.batch]);

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

  const printing = p.state === "printing" || p.state === "cancelling";
  const labels = "count" in summary ? summary.count! * p.copies : 0;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Print
      </h2>

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
          Darkness {p.density}
          <input
            type="range"
            min={1}
            max={5}
            value={p.density}
            onChange={(e) => p.onDensity(Number(e.target.value))}
          />
        </label>
      </div>

      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 text-xs text-neutral-600">Batch</legend>
        <div className="flex gap-3">
          {(["none", "sequence", "list", "csv"] as const).map((k) => (
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
                            ? {
                                kind: "sequence",
                                start: 1,
                                step: 1,
                                count: 10,
                                pad: 0,
                                prefix: "",
                                suffix: "",
                              }
                            : { kind: "list", items: parseList(listText) },
                      )
                }
              />
              {k === "none"
                ? "Single"
                : k === "sequence"
                  ? "Numbers"
                  : k === "list"
                    ? "List"
                    : "Spreadsheet"}
            </label>
          ))}
        </div>

        {p.batch.kind === "sequence" && (
          <SequenceFields b={p.batch} onChange={p.onBatch} />
        )}
        {p.batch.kind === "list" && (
          <textarea
            className={`${field} min-h-24 w-full font-mono text-xs`}
            placeholder="One value per line"
            value={listText}
            onChange={(e) => {
              setListText(e.target.value);
              p.onBatch({ kind: "list", items: parseList(e.target.value) });
            }}
          />
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
        <p className="text-xs text-neutral-500">
          Dates: {"{today}"}, or {"{today+7}"} for a week from now.
        </p>
        {"error" in summary ? (
          <p className="text-xs text-red-700">{summary.error}</p>
        ) : (
          summary.first !== undefined && (
            <p className="text-xs text-neutral-500">
              {summary.count} labels: “{summary.first}” … “{summary.last}” (max{" "}
              {MAX_BATCH})
            </p>
          )
        )}
      </fieldset>

      <div className="flex items-center gap-2">
        {printing ? (
          <>
            <IconButton
              icon={CircleStop}
              label={
                p.state === "cancelling"
                  ? "Stopping after this label"
                  : "Cancel (stops after the current label)"
              }
              variant="warning"
              size="lg"
              onClick={p.onCancel}
              disabled={p.state === "cancelling"}
            />
            {p.state === "cancelling" && (
              <span className="text-xs text-neutral-600">
                Stopping after this label…
              </span>
            )}
          </>
        ) : (
          <IconButton
            icon={Printer}
            label={
              p.state !== "ready"
                ? "Print (connect the printer first)"
                : `Print ${labels} label${labels === 1 ? "" : "s"}`
            }
            variant="primary"
            size="lg"
            badge={labels > 1 ? String(labels) : undefined}
            onClick={p.onPrint}
            disabled={p.state !== "ready" || "error" in summary}
          />
        )}
        {p.progress && printing && (
          <progress
            className="h-2 flex-1"
            max={p.progress.total}
            value={p.progress.done}
            aria-label="Print progress"
          />
        )}
      </div>
      {p.lastResult && (
        <p className="text-sm text-neutral-700" role="status">
          {p.lastResult}
        </p>
      )}
    </section>
  );
}

function SequenceFields({
  b,
  onChange,
}: {
  b: Extract<BatchSpec, { kind: "sequence" }>;
  onChange: (b: BatchSpec) => void;
}) {
  const num = (
    label: string,
    key: "start" | "step" | "count" | "pad",
    min: number,
  ) => (
    <label className="flex flex-col text-xs text-neutral-600">
      {label}
      <input
        className={`${field} w-16 text-sm text-neutral-900`}
        type="number"
        min={min}
        value={b[key]}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value));
          if (Number.isFinite(v)) onChange({ ...b, [key]: Math.max(min, v) });
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
        onChange={(e) => onChange({ ...b, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {text("Prefix", "prefix")}
      {num("Start", "start", -999999)}
      {num("Step", "step", 1)}
      {num("Count", "count", 1)}
      {num("Digits", "pad", 0)}
      {text("Suffix", "suffix")}
    </div>
  );
}
