"use client";

import { BookmarkCheck, BookmarkPlus, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CATALOGUE,
  FAMILY_NAMES,
  type LabelSpec,
  type ShapeFamily,
} from "~/lib/catalogue";
import { resolveLabel, suggestLabelsForCapacity } from "~/lib/labels";
import { useApp, useSessionStatus } from "./app-context";
import { IconButton } from "./IconButton";

const FAMILIES: ShapeFamily[] = ["rect", "round", "wave", "jewelry", "cable"];

export function LabelPicker({
  labelId,
  onChange,
}: {
  labelId: string;
  onChange: (id: string) => void;
}) {
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

  // The tag has no size, but its roll capacity usually identifies the label (e.g. 210 = 31 mm round).
  const suggestions = suggestLabelsForCapacity(status.rfid?.capacity);
  const chooseSuggested = async (id: string) => {
    onChange(id);
    if (!barcode) return;
    await store.rememberBarcode(barcode, id);
    setMapped(id);
  };

  const applyCustom = () => {
    const w = Number(customW);
    const h = Number(customH);
    const id = `custom-${w}x${h}`;
    if (resolveLabel(id)) onChange(id);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Label
      </h2>
      <select
        aria-label="Label size and shape"
        className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5"
        value={isCustom ? "custom" : labelId}
        onChange={(e) =>
          e.target.value === "custom" ? applyCustom() : onChange(e.target.value)
        }
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
            <input
              className="w-20 rounded border px-2 py-1"
              type="number"
              min={5}
              max={50}
              value={customW}
              onChange={(e) => setCustomW(e.target.value)}
            />
          </label>
          <label className="flex flex-col">
            Length mm
            <input
              className="w-20 rounded border px-2 py-1"
              type="number"
              min={5}
              max={200}
              value={customH}
              onChange={(e) => setCustomH(e.target.value)}
            />
          </label>
          <IconButton
            icon={Check}
            label="Use this size"
            onClick={applyCustom}
          />
        </div>
      )}

      {spec && !spec.verified && (
        <p className="text-xs text-amber-700">
          This size comes from NIIMBOT&apos;s listing and hasn&apos;t been
          checked on your printer yet. Print the outline test on the{" "}
          <Link href="/diagnostics/" className="underline">
            Diagnostics
          </Link>{" "}
          page once to confirm it lines up.
        </p>
      )}

      {barcode && mapped === null && (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
          <p>
            New roll (barcode {barcode}). Its tag does not include the size or
            shape.
          </p>
          {suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-neutral-600">
                A {status.rfid?.capacity}-label roll is:
              </p>
              <div className="flex flex-wrap gap-1">
                {suggestions.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    title={`Use ${l.name} and remember this roll`}
                    className="inline-flex items-center gap-1 rounded border border-sky-300 bg-white px-2 py-0.5 text-sky-800 hover:bg-sky-50"
                    onClick={() => void chooseSuggested(l.id)}
                  >
                    <BookmarkCheck size={14} aria-hidden />
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="flex-1">
              {suggestions.length > 0 ? "Otherwise pick" : "Pick"} its label
              above, then remember it.
            </span>
            <IconButton
              icon={BookmarkPlus}
              label={`Remember this roll as ${spec?.name ?? "the current label"}`}
              size="sm"
              onClick={() => void remember()}
            />
          </div>
        </div>
      )}
      {barcode && mapped && (
        <p className="text-xs text-neutral-500">
          Roll {barcode} is remembered as{" "}
          {resolveLabel(mapped, overrides)?.name ?? mapped}.
          {mapped !== labelId && (
            <span className="ml-1 inline-block align-middle">
              <IconButton
                icon={BookmarkPlus}
                label={`Remember this roll as ${spec?.name ?? "the current label"} instead`}
                size="sm"
                onClick={() => void remember()}
              />
            </span>
          )}
        </p>
      )}
      {status.rfid?.tagPresent && (
        <p className="text-xs text-neutral-500">
          {/* Tag counters don't add up to the roll size on real rolls (252 vs 210), so show raw values. */}
          Roll of {status.rfid.capacity ?? status.rfid.allPaper};{" "}
          {status.rfid.usedPaper} used
        </p>
      )}
    </section>
  );
}
