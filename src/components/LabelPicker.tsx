"use client";

import { useEffect, useState } from "react";
import { CATALOGUE, FAMILY_NAMES, type LabelSpec, type ShapeFamily } from "~/lib/catalogue";
import { resolveLabel } from "~/lib/labels";
import { useApp, useSessionStatus } from "./app-context";

const FAMILIES: ShapeFamily[] = ["rect", "round", "wave", "jewelry", "cable"];

export function LabelPicker({ labelId, onChange }: { labelId: string; onChange: (id: string) => void }) {
  const { store, session, overrides } = useApp();
  const status = useSessionStatus(session);
  const barcode = status.rfid?.tagPresent ? status.rfid.barCode : undefined;
  const [mapped, setMapped] = useState<string | null | undefined>(undefined);
  const [customW, setCustomW] = useState("40");
  const [customH, setCustomH] = useState("30");
  const isCustom = labelId.startsWith("custom-");
  const spec = resolveLabel(labelId, overrides);

  // V1: RFID gives a barcode, not a shape. Pre-select the label remembered for this roll.
  useEffect(() => {
    let live = true;
    if (!barcode) {
      setMapped(undefined);
      return;
    }
    void store.labelForBarcode(barcode).then((id) => {
      if (!live) return;
      setMapped(id ?? null);
      if (id && resolveLabel(id, overrides)) onChange(id);
    });
    return () => {
      live = false;
    };
    // Only when a different roll is detected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcode, store]);

  const remember = async () => {
    if (!barcode) return;
    await store.rememberBarcode(barcode, labelId);
    setMapped(labelId);
  };

  const applyCustom = () => {
    const w = Number(customW);
    const h = Number(customH);
    const id = `custom-${w}x${h}`;
    if (resolveLabel(id)) onChange(id);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Label</h2>
      <select
        aria-label="Label size and shape"
        className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5"
        value={isCustom ? "custom" : labelId}
        onChange={(e) => (e.target.value === "custom" ? applyCustom() : onChange(e.target.value))}
      >
        {FAMILIES.map((f) => (
          <optgroup key={f} label={FAMILY_NAMES[f]}>
            {CATALOGUE.filter((l) => l.family === f).map((l: LabelSpec) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="custom">Custom rectangle…</option>
      </select>

      {isCustom && (
        <div className="flex items-end gap-2 text-sm">
          <label className="flex flex-col">
            Width mm
            <input className="w-20 rounded border px-2 py-1" type="number" min={5} max={50} value={customW} onChange={(e) => setCustomW(e.target.value)} />
          </label>
          <label className="flex flex-col">
            Length mm
            <input className="w-20 rounded border px-2 py-1" type="number" min={5} max={200} value={customH} onChange={(e) => setCustomH(e.target.value)} />
          </label>
          <button type="button" className="rounded border px-2 py-1 hover:bg-neutral-100" onClick={applyCustom}>
            Apply
          </button>
        </div>
      )}

      {spec && !spec.verified && (
        <p className="text-xs text-amber-700">
          Shape not yet measured on a real roll. Check the first print; adjust it under Diagnostics if needed.
        </p>
      )}

      {barcode && mapped === null && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">
          New roll detected (barcode {barcode}). Pick its label above, then
          <button type="button" className="ml-1 font-medium text-sky-700 underline" onClick={() => void remember()}>
            remember this roll
          </button>
          .
        </div>
      )}
      {barcode && mapped && (
        <p className="text-xs text-neutral-500">
          Roll {barcode} is remembered as {resolveLabel(mapped, overrides)?.name ?? mapped}.
          {mapped !== labelId && (
            <button type="button" className="ml-1 text-sky-700 underline" onClick={() => void remember()}>
              Update to current label
            </button>
          )}
        </p>
      )}
      {status.rfid?.tagPresent && (
        <p className="text-xs text-neutral-500">
          Labels left on roll: {Math.max(0, status.rfid.allPaper - status.rfid.usedPaper)} of {status.rfid.allPaper}
        </p>
      )}
    </section>
  );
}
