"use client";

import { useEffect, useRef, useState } from "react";
import { type LabelSpec } from "~/lib/catalogue";
import { type Design, type DesignElement } from "~/lib/design";
import { DOTS_PER_MM, dotsToMm, printWindow } from "~/lib/geometry";
import { type MonoBitmap } from "~/lib/render/mono";
import { type Box, boxLines, snapMove, unionBox } from "~/lib/snap";
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
  selectedIds: string[];
  zoom: number;
  /** Select one element (or none); with `additive` toggle it in a multi-selection. */
  onSelect: (id: string | undefined, additive?: boolean) => void;
  /** Elements moved or resized by a drag (one undo step per drag). */
  onChange: (els: DesignElement[]) => void;
  /** A drag finished: the next change is a new undo step. */
  onGestureEnd?: () => void;
}

type Drag = {
  anchorId: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  /** Elements being moved, as they were when the drag started. */
  origs: DesignElement[];
};

function elementLabel(el: DesignElement): string {
  switch (el.kind) {
    case "text":
      return `Text: ${el.text}`;
    case "image":
      return "Image";
    case "shape":
      return `Shape: ${el.shape}`;
    case "icon":
      return `Icon: ${el.name}`;
  }
}

/** Lines to snap to: label centre, printable-area edges, other elements' edges and centres. */
function snapTargets(spec: LabelSpec, others: DesignElement[]) {
  const region = safeRegion(spec);
  const areas: Box[] =
    region.kind === "circle"
      ? [
          {
            x: region.cx - region.r,
            y: region.cy - region.r,
            w: 2 * region.r,
            h: 2 * region.r,
          },
        ]
      : region.rects;
  const lines = boxLines([...areas, ...others]);
  return {
    xs: [spec.widthMm / 2, ...lines.xs],
    ys: [spec.heightMm / 2, ...lines.ys],
  };
}

const MIN_SIZE_MM = 2;

/** Label canvas: printed-pixel preview, die-cut outline, safe area, guides and draggable element boxes. */
export function Workspace({
  spec,
  design,
  preview,
  smooth,
  view,
  selectedIds,
  zoom,
  onSelect,
  onChange,
  onGestureEnd,
}: Props) {
  const pixels = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag>();
  const [guides, setGuides] = useState<{ xs: number[]; ys: number[] }>({
    xs: [],
    ys: [],
  });
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
      if (drag.mode === "resize") {
        const o = drag.origs[0]!;
        onChange([
          {
            ...o,
            w: Math.max(MIN_SIZE_MM, round(o.w + dx)),
            h: Math.max(MIN_SIZE_MM, round(o.h + dy)),
          },
        ]);
        return;
      }
      // Move the whole selection; snap its bounding box unless Alt is held.
      const start = unionBox(drag.origs);
      const moved = {
        ...start,
        x: round(start.x + dx),
        y: round(start.y + dy),
      };
      let fx = moved.x;
      let fy = moved.y;
      if (!e.altKey) {
        const ids = new Set(drag.origs.map((o) => o.id));
        const t = snapTargets(
          spec,
          design.elements.filter((el) => !ids.has(el.id)),
        );
        const snapped = snapMove(moved, t.xs, t.ys);
        fx = snapped.x;
        fy = snapped.y;
        setGuides({ xs: snapped.guidesX, ys: snapped.guidesY });
      } else setGuides({ xs: [], ys: [] });
      const ddx = fx - start.x;
      const ddy = fy - start.y;
      onChange(drag.origs.map((o) => ({ ...o, x: o.x + ddx, y: o.y + ddy })));
    };
    const up = () => {
      setDrag(undefined);
      setGuides({ xs: [], ys: [] });
      onGestureEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, zoom, onChange, onGestureEnd, spec, design.elements]);

  const startDrag = (
    e: React.PointerEvent,
    el: DesignElement,
    mode: Drag["mode"],
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (mode === "move" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      onSelect(el.id, true); // toggle in the multi-selection; no drag
      return;
    }
    // Dragging an already-selected element moves the whole selection.
    const group =
      mode === "move" && selectedIds.includes(el.id)
        ? design.elements.filter((x) => selectedIds.includes(x.id))
        : [el];
    if (!selectedIds.includes(el.id)) onSelect(el.id);
    setDrag({
      anchorId: el.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origs: group,
    });
  };

  return (
    <div
      className="bg-paper relative shadow-sm ring-1 ring-neutral-300"
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
          const selected = selectedIds.includes(el.id);
          const single = selected && selectedIds.length === 1;
          return (
            <div
              key={el.id}
              role="button"
              tabIndex={0}
              aria-label={elementLabel(el)}
              aria-pressed={selected}
              className={`absolute cursor-move ${selected ? "outline-2 outline-sky-500" : "outline-1 outline-transparent hover:outline-neutral-400"} outline-dashed`}
              style={{
                left: el.x * zoom,
                top: el.y * zoom,
                width: el.w * zoom,
                height: el.h * zoom,
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
              onFocus={() => !selected && onSelect(el.id)}
            >
              {single && (
                <span
                  className="absolute -right-1.5 -bottom-1.5 size-3 cursor-se-resize rounded-sm bg-sky-500"
                  onPointerDown={(e) => startDrag(e, el, "resize")}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      {guides.xs.map((x) => (
        <span
          key={`gx${x}`}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-fuchsia-500"
          style={{ left: x * zoom }}
          aria-hidden
        />
      ))}
      {guides.ys.map((y) => (
        <span
          key={`gy${y}`}
          className="pointer-events-none absolute right-0 left-0 h-px bg-fuchsia-500"
          style={{ top: y * zoom }}
          aria-hidden
        />
      ))}
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
