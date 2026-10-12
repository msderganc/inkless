"use client";

import {
  AlignCenter,
  Bookmark,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  FolderSearch,
  Italic,
  Underline,
  BringToFront,
  Copy,
  SendToBack,
  Trash2,
} from "lucide-react";
import { type AlignMode, alignElement } from "~/lib/align";
import { type LabelSpec } from "~/lib/catalogue";
import {
  type DesignElement,
  type IconElement,
  type ImageElement,
  type Rotation,
  type ShapeElement,
  newId,
  type TextElement,
} from "~/lib/design";
import { loadIconLibrary, lucideToSvg } from "~/lib/icons";
import { useState } from "react";
import {
  canListInstalledFonts,
  listInstalledFonts,
  mergeFontLists,
  WINDOWS_FONTS,
} from "~/lib/fonts";
import { useApp } from "./app-context";
import { IconButton } from "./IconButton";

/** Installed fonts, once the user has allowed listing them (kept for the session). */
let installedFonts: string[] | undefined;
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

interface Props {
  element: DesignElement;
  spec: LabelSpec;
  onChange: (el: DesignElement) => void;
  /** Merge a partial change into the current element (safe for several quick edits). */
  onPatch: (id: string, patch: Partial<DesignElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (dir: "up" | "down") => void;
}

const field = "rounded border border-neutral-300 px-2 py-1";
const sectionLabel = "text-xs text-neutral-600";

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
        className={`${field} w-full text-sm text-neutral-900`}
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

const KIND_NAMES: Record<DesignElement["kind"], string> = {
  text: "Text",
  image: "Image",
  shape: "Shape",
  icon: "Icon",
};

export const BOX_ALIGN: {
  mode: AlignMode;
  icon: typeof AlignLeft;
  label: string;
}[] = [
  {
    mode: "left",
    icon: AlignHorizontalJustifyStart,
    label: "Align box left",
  },
  {
    mode: "hcenter",
    icon: AlignHorizontalJustifyCenter,
    label: "Centre box horizontally",
  },
  {
    mode: "right",
    icon: AlignHorizontalJustifyEnd,
    label: "Align box right",
  },
  { mode: "top", icon: AlignVerticalJustifyStart, label: "Align box top" },
  {
    mode: "vcenter",
    icon: AlignVerticalJustifyCenter,
    label: "Centre box vertically",
  },
  {
    mode: "bottom",
    icon: AlignVerticalJustifyEnd,
    label: "Align box bottom",
  },
];

export function ElementPanel({
  element: el,
  spec,
  onChange,
  onPatch,
  onDelete,
  onDuplicate,
  onMove,
}: Props) {
  const set = <T extends DesignElement>(patch: Partial<T>) =>
    onPatch(el.id, patch);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {KIND_NAMES[el.kind]}
        </h2>
        <div className="flex gap-1">
          <IconButton
            icon={Copy}
            label="Duplicate"
            size="sm"
            onClick={onDuplicate}
          />
          <IconButton
            icon={BringToFront}
            label="Bring forward"
            size="sm"
            onClick={() => onMove("up")}
          />
          <IconButton
            icon={SendToBack}
            label="Send back"
            size="sm"
            onClick={() => onMove("down")}
          />
          <IconButton
            icon={Trash2}
            label="Delete"
            size="sm"
            variant="danger"
            onClick={onDelete}
          />
        </div>
      </div>

      {el.kind === "text" && <TextFields el={el} set={set} />}
      {el.kind === "image" && <ImageFields el={el} set={set} />}
      {el.kind === "shape" && <ShapeFields el={el} set={set} />}
      {el.kind === "icon" && <IconFields el={el} set={set} />}

      <div className="space-y-2">
        <p className={sectionLabel}>Position on label</p>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Align box on label"
        >
          {BOX_ALIGN.map((a) => (
            <IconButton
              key={a.mode}
              icon={a.icon}
              label={a.label}
              size="sm"
              onClick={() => onChange(alignElement(el, spec, a.mode))}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
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
      </div>
    </section>
  );
}

const TEXT_ALIGN: {
  value: TextElement["align"];
  icon: typeof AlignLeft;
  label: string;
}[] = [
  { value: "left", icon: AlignLeft, label: "Align text left" },
  { value: "center", icon: AlignCenter, label: "Centre text" },
  { value: "right", icon: AlignRight, label: "Align text right" },
];

function TextFields({
  el,
  set,
}: {
  el: TextElement;
  set: (p: Partial<TextElement>) => void;
}) {
  const [fonts, setFonts] = useState<string[]>(() =>
    mergeFontLists(WINDOWS_FONTS, installedFonts ?? [], [el.fontFamily]),
  );
  const [fontNote, setFontNote] = useState<string>();
  const loadInstalled = async () => {
    try {
      installedFonts = await listInstalledFonts();
      setFonts(mergeFontLists(WINDOWS_FONTS, installedFonts, [el.fontFamily]));
      setFontNote(`${installedFonts.length} installed fonts available.`);
    } catch {
      setFontNote(
        "Font access was not allowed; showing the standard Windows fonts.",
      );
    }
  };
  return (
    <div className="space-y-2">
      <label className="flex flex-col text-xs text-neutral-600">
        Text (use {"{n}"} for the batch value)
        <textarea
          className={`${field} min-h-16 text-sm text-neutral-900`}
          value={el.text}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col text-xs text-neutral-600">
          Font
          <select
            className={`${field} text-sm text-neutral-900`}
            value={el.fontFamily}
            onChange={(e) => set({ fontFamily: e.target.value })}
          >
            {fonts.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
                {f}
              </option>
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
      {canListInstalledFonts() && !installedFonts && (
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <IconButton
            icon={FolderSearch}
            label="Show all fonts installed on this PC (the browser asks permission once)"
            size="sm"
            onClick={() => void loadInstalled()}
          />
          <span>Show all installed fonts</span>
        </div>
      )}
      {fontNote && <p className="text-xs text-neutral-500">{fontNote}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <IconButton
          icon={Bold}
          label="Bold"
          size="sm"
          pressed={el.bold}
          onClick={() => set({ bold: !el.bold })}
        />
        <IconButton
          icon={Italic}
          label="Italic"
          size="sm"
          pressed={el.italic}
          onClick={() => set({ italic: !el.italic })}
        />
        <IconButton
          icon={Underline}
          label="Underline"
          size="sm"
          pressed={el.underline}
          onClick={() => set({ underline: !el.underline })}
        />
        <span className="mx-1 h-5 w-px bg-neutral-300" aria-hidden />
        <div className="flex gap-1" role="group" aria-label="Text alignment">
          {TEXT_ALIGN.map((a) => (
            <IconButton
              key={a.value}
              icon={a.icon}
              label={a.label}
              size="sm"
              pressed={el.align === a.value}
              onClick={() => set({ align: a.value })}
            />
          ))}
        </div>
        <label className="ml-2 flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={el.autoFit}
            onChange={(e) => set({ autoFit: e.target.checked })}
          />
          Shrink to fit
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        Path
        <select
          className={field}
          value={el.arc}
          onChange={(e) => set({ arc: e.target.value as TextElement["arc"] })}
        >
          <option value="none">Straight</option>
          <option value="top">Curved along the top</option>
          <option value="bottom">Curved along the bottom</option>
        </select>
      </label>
      {el.arc !== "none" && (
        <p className="text-xs text-neutral-500">
          Text follows the circle inside the box. Make the box cover the label
          (centre it and set W and H to the label size) for text around the
          edge.
        </p>
      )}
    </div>
  );
}

function ShapeFields({
  el,
  set,
}: {
  el: ShapeElement;
  set: (p: Partial<ShapeElement>) => void;
}) {
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Num
          label="Line mm"
          value={el.strokeMm}
          step={0.1}
          min={0.13}
          max={20}
          onChange={(strokeMm) =>
            set({ strokeMm: Math.min(20, Math.max(0.13, strokeMm)) })
          }
        />
        {el.shape === "rect" && (
          <Num
            label="Corner mm"
            value={el.cornerMm}
            step={0.5}
            min={0}
            onChange={(cornerMm) => set({ cornerMm: Math.max(0, cornerMm) })}
          />
        )}
      </div>
      {(el.shape === "rect" || el.shape === "ellipse") && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={el.fill}
            onChange={(e) => set({ fill: e.target.checked })}
          />
          Filled
        </label>
      )}
      {el.shape === "frame" && (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={el.double}
              onChange={(e) => set({ double: e.target.checked })}
            />
            Double border
          </label>
          <p className="text-xs text-neutral-500">
            The border follows the label&apos;s shape.
          </p>
        </>
      )}
      {el.strokeMm < 0.25 && (
        <p className="text-xs text-amber-700">
          Lines under 0.25 mm (2 printer dots) may print faintly.
        </p>
      )}
    </div>
  );
}

function IconFields({
  el,
  set,
}: {
  el: IconElement;
  set: (p: Partial<IconElement>) => void;
}) {
  const { store } = useApp();
  const [saved, setSaved] = useState<string>();
  const changeWeight = async (weight: number) => {
    const icon = (await loadIconLibrary()).find((i) => i.key === el.libraryKey);
    if (icon) set({ weight, svg: lucideToSvg(icon.node, weight) });
  };
  const saveToMine = async () => {
    try {
      await store.saveIcon({
        id: newId(),
        name: el.name.slice(0, 80) || "AI icon",
        createdAt: Date.now(),
        type: "svg",
        data: el.svg,
      });
      setSaved("Saved to My icons.");
    } catch (e) {
      setSaved(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-neutral-500">
        {el.source === "ai" ? "AI icon" : "Library icon"}: {el.name}
      </p>
      {el.source === "ai" && (
        <div className="flex items-center gap-2">
          <IconButton
            icon={Bookmark}
            label="Save to My icons"
            size="sm"
            onClick={() => void saveToMine()}
          />
          <span className="text-xs text-neutral-600">
            {saved ?? "Save to My icons"}
          </span>
        </div>
      )}
      {el.source === "library" && el.libraryKey && (
        <label className="flex items-center gap-2">
          Line weight
          <input
            type="range"
            min={1.5}
            max={4}
            step={0.25}
            value={el.weight ?? 2.5}
            onChange={(e) => void changeWeight(Number(e.target.value))}
          />
        </label>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={el.invert}
          onChange={(e) => set({ invert: e.target.checked })}
        />
        Invert (white icon on black)
      </label>
    </div>
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
        />
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
        />
        Invert
      </label>
    </div>
  );
}
