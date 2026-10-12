"use client";

import { LabelType, type PaperInfo } from "@mmote/niimbluelib";
import {
  CircleDashed,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  ScrollText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CATALOGUE, type LabelOverride } from "~/lib/catalogue";
import { resolveLabel } from "~/lib/labels";
import { DEFAULT_DENSITY, labelTypeFor } from "~/lib/printer/session";
import { browserEnv } from "~/lib/render/browser-env";
import { encodeForPrinter } from "~/lib/render/encode";
import { shiftColumns } from "~/lib/render/mono";
import { outlineTest } from "~/lib/render/outline-test";
import { testPattern } from "~/lib/render/test-pattern";
import { overrideSchema } from "~/lib/store/store";
import { useApp, useSessionStatus } from "./app-context";
import { IconButton } from "./IconButton";
import { StatusBar } from "./StatusBar";

const box = "space-y-3 rounded border border-neutral-200 bg-white p-4";

export default function Diagnostics() {
  const { session, settings, updateSettings, overrides } = useApp();
  const status = useSessionStatus(session);
  const ready = status.state === "ready";
  const [paper, setPaper] = useState<PaperInfo | null>();
  const [result, setResult] = useState<string>();
  const [log, setLog] = useState(session.getPacketLog());

  useEffect(() => {
    if (!settings.diagnostics) return;
    const t = setInterval(() => setLog(session.getPacketLog()), 1_000);
    return () => clearInterval(t);
  }, [session, settings.diagnostics]);

  const [testLabelId, setTestLabelId] = useState(
    settings.lastLabelId && resolveLabel(settings.lastLabelId)
      ? settings.lastLabelId
      : "round-31",
  );

  const printOutline = async () => {
    setResult(undefined);
    const spec = resolveLabel(testLabelId, overrides);
    if (!spec) return;
    try {
      const out = await session.print({
        pageCount: 1,
        copies: 1,
        density: DEFAULT_DENSITY,
        labelType: labelTypeFor(spec.stock),
        renderPage: async () =>
          encodeForPrinter(
            outlineTest(spec, browserEnv, settings.offsetDots).print,
          ),
      });
      setResult(
        out.status === "failed"
          ? out.error
          : `Outline test (${spec.name}) ${out.status}.`,
      );
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    }
  };

  const printPattern = async () => {
    setResult(undefined);
    try {
      const out = await session.print({
        pageCount: 1,
        copies: 1,
        density: DEFAULT_DENSITY,
        labelType: LabelType.WithGaps,
        renderPage: async () =>
          encodeForPrinter(shiftColumns(testPattern(30), settings.offsetDots)),
      });
      setResult(
        out.status === "failed" ? out.error : `Test pattern ${out.status}.`,
      );
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <StatusBar page="diagnostics" />
      <main className="mx-auto grid max-w-5xl gap-4 p-6 md:grid-cols-2">
        <section className={box}>
          <h2 className="font-semibold">Printer</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-neutral-500">Model</dt>
            <dd>
              {status.identity
                ? `${status.identity.model ?? "?"} (id ${status.identity.modelId})`
                : "—"}
            </dd>
            <dt className="text-neutral-500">Firmware</dt>
            <dd>{status.identity?.firmware ?? "—"}</dd>
            <dt className="text-neutral-500">Hardware</dt>
            <dd>{status.identity?.hardware ?? "—"}</dd>
            <dt className="text-neutral-500">Serial</dt>
            <dd>{status.identity?.serial ?? "—"}</dd>
            <dt className="text-neutral-500">Lid</dt>
            <dd>
              {status.heartbeat?.lidClosed === undefined
                ? "—"
                : status.heartbeat.lidClosed
                  ? "Closed"
                  : "Open"}
            </dd>
            <dt className="text-neutral-500">Labels loaded</dt>
            <dd>
              {status.heartbeat?.paperInserted === undefined
                ? "—"
                : status.heartbeat.paperInserted
                  ? "Yes"
                  : "No"}
            </dd>
          </dl>
        </section>

        <section className={box}>
          <h2 className="font-semibold">Label roll (RFID)</h2>
          {status.rfid?.tagPresent ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-neutral-500">Barcode</dt>
              <dd className="font-mono">{status.rfid.barCode}</dd>
              <dt className="text-neutral-500">Serial</dt>
              <dd className="font-mono">{status.rfid.serialNumber}</dd>
              <dt className="text-neutral-500">Used / total</dt>
              <dd>
                {status.rfid.usedPaper} / {status.rfid.allPaper}
              </dd>
              <dt className="text-neutral-500">Type</dt>
              <dd>
                {LabelType[status.rfid.consumablesType] ??
                  status.rfid.consumablesType}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-neutral-500">No tag read.</p>
          )}
          <div className="flex gap-2">
            <IconButton
              icon={RefreshCw}
              label="Re-read roll tag"
              disabled={!ready}
              onClick={() => void session.refreshRfid()}
            />
            <IconButton
              icon={ScrollText}
              label="Read paper info (not supported by B21S firmware 40.33)"
              disabled={!ready}
              onClick={() =>
                void session.readPaperInfo().then((p) => setPaper(p ?? null))
              }
            />
          </div>
          {paper === null && (
            <p className="text-sm text-neutral-500">
              The printer did not report paper info.
            </p>
          )}
          {paper && (
            <pre className="overflow-auto rounded bg-neutral-50 p-2 text-xs">
              {JSON.stringify(paper, null, 2)}
            </pre>
          )}
        </section>

        <section className={box}>
          <h2 className="font-semibold">Test print and calibration</h2>
          <p className="text-sm text-neutral-600">
            <strong>Outline test</strong> (any roll): prints the printable-area
            outline, a centre crosshair with 1 mm ticks and the size. It should
            sit evenly about 1 mm inside the die-cut edge. Rolls narrower than
            the head sit at its left end (verified on 31 mm round). If a print
            is off to one side, adjust the offset (8 dots ≈ 1 mm); it shifts
            every print.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Label loaded in the printer"
              className="rounded border px-2 py-1 text-sm"
              value={testLabelId}
              onChange={(e) => setTestLabelId(e.target.value)}
            >
              {CATALOGUE.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <IconButton
              icon={CircleDashed}
              label="Print outline test"
              variant="primary"
              disabled={!ready}
              onClick={() => void printOutline()}
            />
          </div>
          <p className="text-sm text-neutral-600">
            <strong>Ruler pattern</strong> (50 mm wide rectangular stock only):
            a 48 mm ruler with darkness blocks on a 30 mm label.
          </p>
          <div className="flex items-center gap-3">
            <IconButton
              icon={Ruler}
              label="Print ruler pattern"
              disabled={!ready}
              onClick={() => void printPattern()}
            />
            <label className="flex items-center gap-2 text-sm">
              Offset (dots)
              <input
                className="w-20 rounded border px-2 py-1"
                type="number"
                min={-16}
                max={16}
                value={settings.offsetDots}
                onChange={(e) =>
                  void updateSettings({
                    offsetDots: Math.max(
                      -16,
                      Math.min(16, Math.round(Number(e.target.value) || 0)),
                    ),
                  })
                }
              />
            </label>
          </div>
          {result && (
            <p className="text-sm" role="status">
              {result}
            </p>
          )}
        </section>

        <LabelCalibration />

        <section className={`${box} md:col-span-2`}>
          <h2 className="font-semibold">Troubleshooting log</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.diagnostics}
              onChange={(e) =>
                void updateSettings({ diagnostics: e.target.checked })
              }
            />
            Record the last 500 printer packets (off by default; kept only in
            memory)
          </label>
          {settings.diagnostics && (
            <pre className="max-h-80 overflow-auto rounded bg-neutral-900 p-2 text-xs text-neutral-100">
              {log
                .map(
                  (e) =>
                    `${new Date(e.time).toISOString().slice(11, 23)} ${e.dir} ${e.hex}`,
                )
                .join("\n") || "No packets yet."}
            </pre>
          )}
        </section>
      </main>
    </div>
  );
}

/** Save measured geometry for a label (Wave 5: correct the unverified catalogue). */
function LabelCalibration() {
  const { store, overrides, reloadOverrides } = useApp();
  const [labelId, setLabelId] = useState(CATALOGUE[0]!.id);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string>();
  const spec = resolveLabel(labelId, overrides)!;

  useEffect(() => {
    setText(JSON.stringify(overrides[labelId] ?? {}, null, 2));
    setMsg(undefined);
  }, [labelId, overrides]);

  const save = async () => {
    try {
      const parsed = overrideSchema.parse(JSON.parse(text)) as LabelOverride;
      await store.saveOverride(labelId, parsed);
      await reloadOverrides();
      setMsg("Saved.");
    } catch {
      setMsg(
        "Invalid. Allowed keys: widthMm, heightMm, cornerRadiusMm, panels [{y,height},{y,height}], flag {y,height}, wrap {y,height}.",
      );
    }
  };

  return (
    <section className={box}>
      <h2 className="font-semibold">Measured label geometry</h2>
      <select
        className="w-full rounded border px-2 py-1 text-sm"
        value={labelId}
        onChange={(e) => setLabelId(e.target.value)}
      >
        {CATALOGUE.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <p className="text-xs text-neutral-600">
        Current: {spec.widthMm} × {spec.heightMm} mm
        {spec.panels &&
          `, panels ${spec.panels.map((p) => `${p.y}+${p.height}`).join(" / ")} mm`}
        {spec.flag && `, flag ${spec.flag.y}+${spec.flag.height}`}
        {spec.wrap && `, wrap ${spec.wrap.y}+${spec.wrap.height} mm`}
      </p>
      <textarea
        className="min-h-28 w-full rounded border p-2 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Override JSON"
      />
      <div className="flex gap-2">
        <IconButton
          icon={Save}
          label="Save measured geometry"
          onClick={() => void save()}
        />
        <IconButton
          icon={RotateCcw}
          label="Reset to catalogue values"
          onClick={async () => {
            await store.clearOverride(labelId);
            await reloadOverrides();
            setMsg("Reset to catalogue values.");
          }}
        />
      </div>
      {msg && <p className="text-xs text-neutral-700">{msg}</p>}
    </section>
  );
}
