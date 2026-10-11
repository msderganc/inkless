"use client";

import {
  type DesignElement,
  type ImageElement,
  type Rotation,
  type TextElement,
} from "~/lib/design";

const FONTS = [
  "Arial",
  "Segoe UI",
  "Calibri",
  "Consolas",
  "Times New Roman",
  "Georgia",
  "Impact",
  "Verdana",
];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

interface Props {
  element: DesignElement;
  onChange: (el: DesignElement) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (dir: "up" | "down") => void;
}

const field = "rounded border border-neutral-300 px-2 py-1";

function Num({
  label,
  value,
  step = 0.5,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col text-xs text-neutral-600">
      {label}
      <input
        className={`${field} w-20 text-sm text-neutral-900`}
        type="number"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

export function ElementPanel({
  element: el,
  onChange,
  onDelete,
  onDuplicate,
  onMove,
}: Props) {
  const set = <T extends DesignElement>(patch: Partial<T>) =>
    onChange({ ...el, ...patch });

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {el.kind === "text" ? "Text" : "Image"}
      </h2>

      {el.kind === "text" && <TextFields el={el} set={set} />}
      {el.kind === "image" && <ImageFields el={el} set={set} />}

      <div className="flex flex-wrap gap-2">
        <Num label="X mm" value={el.x} onChange={(x) => set({ x })} />
        <Num label="Y mm" value={el.y} onChange={(y) => set({ y })} />
        <Num
          label="W mm"
          value={el.w}
          min={1}
          onChange={(w) => set({ w: Math.max(1, w) })}
        />
        <Num
          label="H mm"
          value={el.h}
          min={1}
          onChange={(h) => set({ h: Math.max(1, h) })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        Rotation
        <select
          className={field}
          value={el.rotation}
          onChange={(e) =>
            set({ rotation: Number(e.target.value) as Rotation })
          }
        >
          {ROTATIONS.map((r) => (
            <option key={r} value={r}>
              {r}°
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className="rounded border px-2 py-1 hover:bg-neutral-100"
          onClick={onDuplicate}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 hover:bg-neutral-100"
          onClick={() => onMove("up")}
        >
          Bring forward
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 hover:bg-neutral-100"
          onClick={() => onMove("down")}
        >
          Send back
        </button>
        <button
          type="button"
          className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </section>
  );
}

function TextFields({
  el,
  set,
}: {
  el: TextElement;
  set: (p: Partial<TextElement>) => void;
}) {
  return (
    <>
      <label className="flex flex-col text-xs text-neutral-600">
        Text (use {"{n}"} for the batch value)
        <textarea
          className={`${field} min-h-16 text-sm text-neutral-900`}
          value={el.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-neutral-600">
          Font
          <select
            className={`${field} text-sm text-neutral-900`}
            value={el.fontFamily}
            onChange={(e) => set({ fontFamily: e.target.value })}
          >
            {FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <Num
          label="Size mm"
          value={el.fontSizeMm}
          min={0.5}
          max={100}
          onChange={(fontSizeMm) =>
            set({ fontSizeMm: Math.max(0.5, fontSizeMm) })
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={el.bold}
            onChange={(e) => set({ bold: e.target.checked })}
          />{" "}
          Bold
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={el.autoFit}
            onChange={(e) => set({ autoFit: e.target.checked })}
          />{" "}
          Shrink to fit
        </label>
        <select
          className={field}
          aria-label="Alignment"
          value={el.align}
          onChange={(e) =>
            set({ align: e.target.value as TextElement["align"] })
          }
        >
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </div>
    </>
  );
}

function ImageFields({
  el,
  set,
}: {
  el: ImageElement;
  set: (p: Partial<ImageElement>) => void;
}) {
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={el.dither}
          onChange={(e) => set({ dither: e.target.checked })}
        />{" "}
        Dither (photos)
      </label>
      {!el.dither && (
        <label className="flex items-center gap-2">
          Threshold
          <input
            type="range"
            min={0}
            max={255}
            value={el.threshold}
            onChange={(e) => set({ threshold: Number(e.target.value) })}
          />
          <span className="w-8 text-right tabular-nums">{el.threshold}</span>
        </label>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={el.invert}
          onChange={(e) => set({ invert: e.target.checked })}
        />{" "}
        Invert
      </label>
    </div>
  );
}
