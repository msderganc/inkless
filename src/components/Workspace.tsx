"use client";

import { useEffect, useRef, useState } from "react";
import { type LabelSpec } from "~/lib/catalogue";
import { type Design, type DesignElement } from "~/lib/design";
import { DOTS_PER_MM, dotsToMm, printWindow } from "~/lib/geometry";
import { type MonoBitmap } from "~/lib/render/mono";
import { type CanvasLike } from "~/lib/render/render";
import {
  guideLines,
  safeRegion,
  traceOutline,
  traceRegion,
} from "~/lib/shapes";

interface Props {
  spec: LabelSpec;
  design: Design;
  /** Exact 1-bit output (As printed view). */
  preview?: MonoBitmap;
  /** Anti-aliased preview at zoom × devicePixelRatio (Design view). */
  smooth?: CanvasLike;
  view: "design" | "print";
  selectedId?: string;
  zoom: number;
  onSelect: (id: string | undefined) => void;
  onChange: (el: DesignElement) => void;
}

type Drag = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  orig: DesignElement;
};

const MIN_SIZE_MM = 2;

/** Label canvas: printed-pixel preview, die-cut outline, safe area, guides and draggable element boxes. */
export function Workspace({
  spec,
  design,
  preview,
  smooth,
  view,
  selectedId,
  zoom,
  onSelect,
  onChange,
}: Props) {
  const pixels = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag>();
  const w = spec.widthMm * zoom;
  const h = spec.heightMm * zoom;

  useEffect(() => {
    const c = pixels.current;
    if (!c) return;
    if (view === "design" && smooth) {
      // Smooth preview is rendered at zoom × devicePixelRatio, so draw it 1:1.
      c.width = smooth.width;
      c.height = smooth.height;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(smooth as CanvasImageSource, 0, 0);
      return;
    }
    if (!preview) return;
    c.width = preview.width;
    c.height = preview.height;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(preview.width, preview.height);
    for (let i = 0; i < preview.data.length; i++) {
      const v = preview.data[i] ? 20 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = preview.data[i] ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
  }, [preview, smooth, view]);

  useEffect(() => {
    const c = overlay.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Columns the printhead cannot reach (50 mm stock is wider than the 48 mm head).
    const win = printWindow(spec.widthMm);
    ctx.fillStyle = "rgba(220, 38, 38, 0.12)";
    const left = dotsToMm(win.start) * zoom;
    const right = dotsToMm(win.start + win.width) * zoom;
    if (left > 0) ctx.fillRect(0, 0, left, h);
    if (right < w) ctx.fillRect(right, 0, w - right, h);

    traceOutline(ctx, spec, zoom);
    ctx.strokeStyle = "#525252";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    traceRegion(ctx, safeRegion(spec), zoom);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#0ea5e9";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = "#f59e0b";
    for (const y of guideLines(spec)) {
      ctx.beginPath();
      ctx.moveTo(0, y * zoom);
      ctx.lineTo(w, y * zoom);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, [spec, zoom, w, h]);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      const round = (v: number) => Math.round(v * 4) / 4; // 0.25 mm steps
      const o = drag.orig;
      if (drag.mode === "move")
        onChange({ ...o, x: round(o.x + dx), y: round(o.y + dy) });
      else
        onChange({
          ...o,
          w: Math.max(MIN_SIZE_MM, round(o.w + dx)),
          h: Math.max(MIN_SIZE_MM, round(o.h + dy)),
        });
    };
    const up = () => setDrag(undefined);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, zoom, onChange]);

  const startDrag = (
    e: React.PointerEvent,
    el: DesignElement,
    mode: Drag["mode"],
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(el.id);
    setDrag({
      id: el.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: el,
    });
  };

  return (
    <div
      className="relative bg-white shadow-sm ring-1 ring-neutral-300"
      style={{
        width: w,
        height: h,
        borderRadius:
          spec.family === "round" || spec.family === "wave" ? "50%" : 6,
      }}
      onPointerDown={() => onSelect(undefined)}
    >
      <canvas
        ref={pixels}
        className="pointer-events-none absolute inset-0"
        style={{
          width: w,
          height: h,
          imageRendering: view === "design" && smooth ? "auto" : "pixelated",
        }}
        aria-label={view === "design" ? "Design preview" : "Print preview"}
      />
      <canvas
        ref={overlay}
        className="pointer-events-none absolute inset-0"
        style={{ width: w, height: h }}
        aria-hidden
      />
      {view === "design" &&
        design.elements.map((el) => {
          const selected = el.id === selectedId;
          return (
            <div
              key={el.id}
              role="button"
              tabIndex={0}
              aria-label={el.kind === "text" ? `Text: ${el.text}` : "Image"}
              aria-pressed={selected}
              className={`absolute cursor-move ${selected ? "outline-2 outline-sky-500" : "outline-1 outline-transparent hover:outline-neutral-400"} outline-dashed`}
              style={{
                left: el.x * zoom,
                top: el.y * zoom,
                width: el.w * zoom,
                height: el.h * zoom,
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
              onFocus={() => onSelect(el.id)}
            >
              {selected && (
                <span
                  className="absolute -right-1.5 -bottom-1.5 size-3 cursor-se-resize rounded-sm bg-sky-500"
                  onPointerDown={(e) => startDrag(e, el, "resize")}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
    </div>
  );
}

export const DEFAULT_ZOOM = Math.round(DOTS_PER_MM); // ~1 screen px per printer dot

/** Key for the workspace overlays; only lists what applies to the current label. */
export function WorkspaceLegend({ spec }: { spec: LabelSpec }) {
  const win = printWindow(spec.widthMm);
  const guide =
    spec.family === "jewelry"
      ? "Fold line"
      : spec.family === "cable"
        ? "Flag / wrap boundary"
        : undefined;
  const items: { swatch: React.ReactNode; text: string }[] = [
    {
      swatch: (
        <span className="inline-block h-3 w-5 rounded-sm border-2 border-neutral-600" />
      ),
      text: "Label edge",
    },
    {
      swatch: (
        <span className="inline-block h-3 w-5 rounded-sm border-2 border-dashed border-sky-500" />
      ),
      text: "Printable area",
    },
  ];
  if (guide) {
    items.push({
      swatch: (
        <span className="inline-block w-5 border-t-2 border-dashed border-amber-500" />
      ),
      text: guide,
    });
  }
  if (win.width < win.labelDots) {
    items.push({
      swatch: (
        <span className="inline-block h-3 w-5 rounded-sm bg-red-600/15" />
      ),
      text: "Beyond printhead",
    });
  }
  return (
    <ul
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-600"
      aria-label="Legend"
    >
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-1.5">
          {i.swatch}
          {i.text}
        </li>
      ))}
    </ul>
  );
}
