"use client";

import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Frame,
  ImagePlus,
  Minus,
  PencilRuler,
  Printer,
  Redo2,
  Shapes,
  Sparkles,
  Spline,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alignGroup, alignmentArea } from "~/lib/align";
import { batchRecords, type BatchSpec, recordLabel } from "~/lib/batch";
import {
  type DesignElement,
  designUsesBatch,
  emptyDesign,
  type ImageElement,
  newIcon,
  newId,
  newShape,
  newText,
  type ShapeElement,
} from "~/lib/design";
import { resolveLabel } from "~/lib/labels";
import { DEFAULT_DENSITY, labelTypeFor } from "~/lib/printer/session";
import { browserEnv } from "~/lib/render/browser-env";
import { encodeForPrinter } from "~/lib/render/encode";
import { type MonoBitmap } from "~/lib/render/mono";
import {
  type CanvasLike,
  renderLabel,
  renderPreview,
} from "~/lib/render/render";
import { type Draft, newTemplate, type Template } from "~/lib/store/store";
import { AiIconDialog } from "./AiIconDialog";
import { AiSettingsDialog } from "./AiSettingsDialog";
import { useApp, useSessionStatus } from "./app-context";
import { BOX_ALIGN, ElementPanel } from "./ElementPanel";
import { IconButton } from "./IconButton";
import { IconLibraryDialog } from "./IconLibraryDialog";
import { LabelPicker } from "./LabelPicker";
import { PrintPanel } from "./PrintPanel";
import { StatusBar } from "./StatusBar";
import { TemplatesPanel } from "./TemplatesPanel";
import { useDesignHistory } from "./useDesignHistory";
import { DEFAULT_ZOOM, Workspace, WorkspaceLegend } from "./Workspace";

const DEFAULT_LABEL = "rect-50x30";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type Dialog = "library" | "ai" | "ai-settings" | undefined;

export default function Editor() {
  const { store, session, settings, updateSettings, overrides, initialDraft } =
    useApp();
  const status = useSessionStatus(session);
  const initialLabel =
    settings.lastLabelId && resolveLabel(settings.lastLabelId, overrides)
      ? settings.lastLabelId
      : DEFAULT_LABEL;
  // Restore the work in progress from before the last refresh (if its label still exists).
  const draft =
    initialDraft && resolveLabel(initialDraft.design.labelId, overrides)
      ? initialDraft
      : undefined;

  const {
    design,
    update: setDesign,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDesignHistory(() => draft?.design ?? emptyDesign(initialLabel));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batch, setBatch] = useState<BatchSpec>(
    () => draft?.batch ?? { kind: "none" },
  );
  const [density, setDensity] = useState(draft?.density ?? DEFAULT_DENSITY);
  const [copies, setCopies] = useState(draft?.copies ?? 1);
  const [current, setCurrent] = useState<
    { id: string; name: string } | undefined
  >(draft?.template);
  const [view, setView] = useState<"design" | "print">(draft?.view ?? "design");
  const [zoom, setZoom] = useState(draft?.zoom ?? DEFAULT_ZOOM);
  const [dialog, setDialog] = useState<Dialog>();

  // Autosave the work in progress so it survives a refresh (debounced; flushed when hidden).
  const latestDraft = useRef<Draft | undefined>(undefined);
  useEffect(() => {
    latestDraft.current = {
      design,
      batch,
      density,
      copies,
      template: current,
      view,
      zoom,
      savedAt: Date.now(),
    };
    const t = setTimeout(() => {
      if (latestDraft.current)
        void store.saveDraft(latestDraft.current).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [store, design, batch, density, copies, current, view, zoom]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && latestDraft.current) {
        void store.saveDraft(latestDraft.current).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [store]);

  const [preview, setPreview] = useState<MonoBitmap>();
  const [smooth, setSmooth] = useState<CanvasLike>();
  const [previewError, setPreviewError] = useState<string>();
  const [lastResult, setLastResult] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loads, setLoads] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);

  // Memoised: custom/overridden specs are new objects, which would otherwise re-trigger rendering forever.
  const spec = useMemo(
    () =>
      resolveLabel(design.labelId, overrides) ?? resolveLabel(DEFAULT_LABEL)!,
    [design.labelId, overrides],
  );
  // Drop selections of elements that no longer exist (undo, delete, template load).
  const selected = design.elements.filter((e) => selectedIds.includes(e.id));
  const single = selected.length === 1 ? selected[0] : undefined;

  // Batch records for stepping through the preview ([null] when not a batch or invalid).
  const records = useMemo(() => {
    try {
      return batchRecords(batch);
    } catch {
      return [null];
    }
  }, [batch]);
  const isBatch = records.length > 1 || records[0] !== null;
  const [previewIndex, setPreviewIndex] = useState(0);
  const shownIndex = Math.min(previewIndex, records.length - 1);
  const previewRecord = records[shownIndex] ?? null;
  const step = useCallback(
    (delta: number) =>
      setPreviewIndex((i) =>
        Math.max(
          0,
          Math.min(records.length - 1, Math.min(i, records.length - 1) + delta),
        ),
      ),
    [records.length],
  );

  // Re-render the preview (debounced; stale renders are discarded).
  const renderSeq = useRef(0);
  useEffect(() => {
    const seq = ++renderSeq.current;
    const t = setTimeout(() => {
      // Design view: smooth, screen-resolution preview. As printed: the exact 203 DPI dots.
      const work =
        view === "design"
          ? renderPreview(
              design,
              spec,
              browserEnv,
              zoom * (window.devicePixelRatio || 1),
              {
                record: previewRecord,
              },
            ).then((c) => {
              if (seq === renderSeq.current) setSmooth(c);
            })
          : renderLabel(design, spec, browserEnv, {
              record: previewRecord,
              offsetDots: settings.offsetDots,
            }).then((r) => {
              if (seq === renderSeq.current) setPreview(r.label);
            });
      work
        .then(() => seq === renderSeq.current && setPreviewError(undefined))
        .catch(
          (e: unknown) =>
            seq === renderSeq.current &&
            setPreviewError(e instanceof Error ? e.message : String(e)),
        );
    }, 80);
    return () => clearTimeout(t);
  }, [design, spec, previewRecord, settings.offsetDots, view, zoom]);

  /** Replace whole elements (alignment, drags). */
  const replaceElements = useCallback(
    (els: DesignElement[], key?: string) => {
      const byId = new Map(els.map((e) => [e.id, e]));
      setDesign(
        (d) => ({ ...d, elements: d.elements.map((e) => byId.get(e.id) ?? e) }),
        key,
      );
    },
    [setDesign],
  );
  const updateElement = useCallback(
    (el: DesignElement) => replaceElements([el]),
    [replaceElements],
  );
  const onWorkspaceChange = useCallback(
    (els: DesignElement[]) =>
      replaceElements(els, `drag:${els.map((e) => e.id).join(",")}`),
    [replaceElements],
  );
  // Merge into the latest state so quick successive edits (e.g. italic then underline) all stick.
  const patchElement = useCallback(
    (id: string, patch: Partial<DesignElement>) => {
      setDesign(
        (d) => ({
          ...d,
          elements: d.elements.map((e) =>
            e.id === id ? ({ ...e, ...patch } as DesignElement) : e,
          ),
        }),
        `patch:${id}:${Object.keys(patch).sort().join(",")}`,
      );
    },
    [setDesign],
  );

  const addElement = (el: DesignElement) => {
    setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
    setSelectedIds([el.id]);
  };

  /** A centred box of size w×h inside the printable area (whole area if larger). */
  const centredBox = (w: number, h: number) => {
    const area = alignmentArea(
      newText(0, 0, spec.widthMm, spec.heightMm),
      spec,
    );
    const bw = Math.min(w, area.w);
    const bh = Math.min(h, area.h);
    return {
      x: area.x + (area.w - bw) / 2,
      y: area.y + (area.h - bh) / 2,
      w: bw,
      h: bh,
      area,
    };
  };

  const addText = () => {
    const b = centredBox(spec.widthMm, 10);
    addElement(newText(b.x, b.y, b.w, Math.max(4, b.h)));
  };
  const addCurvedText = () => {
    const b = centredBox(spec.widthMm, spec.heightMm);
    const size = Math.min(b.w, b.h);
    addElement({
      ...newText(b.x + (b.w - size) / 2, b.y + (b.h - size) / 2, size, size),
      text: "Curved text",
      fontSizeMm: Math.max(2.5, size * 0.12),
      arc: "top",
    });
  };
  const addShape = (shape: ShapeElement["shape"]) => {
    if (shape === "frame") {
      addElement(newShape("frame", 0, 0, spec.widthMm, spec.heightMm));
      return;
    }
    const s = Math.min(spec.widthMm, spec.heightMm) * 0.5;
    const b = centredBox(
      shape === "line" ? spec.widthMm * 0.7 : s * 1.4,
      shape === "line" ? 2 : s,
    );
    addElement(newShape(shape, b.x, b.y, b.w, b.h));
  };
  const addIcon = (
    svg: string,
    name: string,
    source: "library" | "ai",
    libraryKey?: string,
    weight?: number,
  ) => {
    const size = Math.min(spec.widthMm, spec.heightMm) * 0.55;
    const b = centredBox(size, size);
    addElement({
      ...newIcon(svg, name, source, b.x, b.y, Math.min(b.w, b.h)),
      libraryKey,
      weight,
    });
    setDialog(undefined);
  };

  const addImage = async (file: File) => {
    if (file.size > MAX_IMAGE_BYTES) {
      setLastResult("That image is larger than 4 MB. Use a smaller file.");
      return;
    }
    const src = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () =>
        typeof r.result === "string"
          ? resolve(r.result)
          : reject(new Error("Could not read the image."));
      r.onerror = () => reject(new Error("Could not read the image."));
      r.readAsDataURL(file);
    });
    const size = Math.min(spec.widthMm, spec.heightMm) - 4;
    const b = centredBox(size, size);
    const el: ImageElement = {
      id: newId(),
      kind: "image",
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      rotation: 0,
      src,
      dither: false,
      threshold: 128,
      invert: false,
    };
    addElement(el);
  };

  const removeSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setDesign((d) => ({
      ...d,
      elements: d.elements.filter((e) => !selectedIds.includes(e.id)),
    }));
    setSelectedIds([]);
  }, [selectedIds, setDesign]);

  const duplicateSelected = useCallback(() => {
    if (selected.length === 0) return;
    const copies = selected.map((e) => ({
      ...e,
      id: newId(),
      x: e.x + 1,
      y: e.y + 1,
    }));
    setDesign((d) => ({ ...d, elements: [...d.elements, ...copies] }));
    setSelectedIds(copies.map((c) => c.id));
  }, [selected, setDesign]);

  const moveSelected = (dir: "up" | "down") =>
    setDesign((d) => {
      const i = d.elements.findIndex((e) => e.id === single?.id);
      const j = dir === "up" ? i + 1 : i - 1;
      if (i < 0 || j < 0 || j >= d.elements.length) return d;
      const els = [...d.elements];
      [els[i], els[j]] = [els[j]!, els[i]!];
      return { ...d, elements: els };
    });

  const select = useCallback((id: string | undefined, additive?: boolean) => {
    if (!id) setSelectedIds([]);
    else if (additive)
      setSelectedIds((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      );
    else setSelectedIds([id]);
  }, []);

  // Keyboard: undo/redo, select all, duplicate, delete, arrows nudge 0.25 mm (Shift = 1 mm).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
        t.isContentEditable;
      if (typing || document.querySelector("dialog[open]")) return; // native undo in fields; dialogs own keys
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && k === "a") {
        e.preventDefault();
        setSelectedIds(design.elements.map((x) => x.id));
      } else if (mod && k === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (
        selected.length &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") {
        setSelectedIds([]);
      } else if (selected.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const s = e.shiftKey ? 1 : 0.25;
        const [dx, dy] = {
          ArrowLeft: [-s, 0],
          ArrowRight: [s, 0],
          ArrowUp: [0, -s],
          ArrowDown: [0, s],
        }[e.key] ?? [0, 0];
        replaceElements(
          selected.map((x) => ({ ...x, x: x.x + dx!, y: x.y + dy! })),
          "nudge",
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selected,
    design.elements,
    removeSelected,
    duplicateSelected,
    replaceElements,
    undo,
    redo,
  ]);

  const changeLabel = (labelId: string) => {
    setDesign((d) => (d.labelId === labelId ? d : { ...d, labelId }));
    if (labelId !== settings.lastLabelId)
      void updateSettings({ lastLabelId: labelId });
  };

  const print = async () => {
    setLastResult(undefined);
    let recs: ReturnType<typeof batchRecords>;
    try {
      recs = batchRecords(batch);
    } catch (e) {
      setLastResult(e instanceof Error ? e.message : String(e));
      return;
    }
    const printDesign = design;
    const printSpec = spec;
    const now = new Date(); // one date for the whole job
    try {
      const out = await session.print({
        pageCount: recs.length,
        copies,
        density,
        labelType: labelTypeFor(printSpec.stock),
        renderPage: async (i) =>
          encodeForPrinter(
            (
              await renderLabel(printDesign, printSpec, browserEnv, {
                record: recs[i] ?? null,
                now,
                offsetDots: settings.offsetDots,
              })
            ).print,
          ),
      });
      const n = (k: number) => `${k} label${k === 1 ? "" : "s"}`;
      const total = n(out.printed * copies);
      if (out.status === "failed")
        setLastResult(`Stopped after ${total}: ${out.error}`);
      else
        setLastResult(
          out.status === "completed"
            ? `Printed ${total}.`
            : `Cancelled after ${total}.`,
        );
    } catch (e) {
      setLastResult(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async (name: string, asNew: boolean) => {
    const base = newTemplate(name, design, batch, density, copies);
    const t: Template = current && !asNew ? { ...base, id: current.id } : base;
    await store.saveTemplate(t);
    setCurrent({ id: t.id, name });
    setRevision((r) => r + 1);
  };

  const load = (t: Template) => {
    if (!resolveLabel(t.design.labelId, overrides)) {
      setLastResult(
        `"${t.name}" uses an unknown label (${t.design.labelId}). Pick the label before printing.`,
      );
    }
    setLoads((n) => n + 1);
    setDesign(t.design);
    setBatch(t.batch);
    setDensity(t.density);
    setCopies(t.copies);
    setCurrent({ id: t.id, name: t.name });
    setSelectedIds([]);
    changeLabel(t.design.labelId);
  };

  const shownLabel = recordLabel(batch, previewRecord);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-100 text-neutral-900">
      <StatusBar page="editor" />
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="space-y-6 border-neutral-200 bg-white p-4 lg:w-72 lg:border-r">
          <LabelPicker labelId={design.labelId} onChange={changeLabel} />
          <section className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Add
            </h2>
            <div className="flex flex-wrap gap-1.5">
              <IconButton icon={Type} label="Add text" onClick={addText} />
              <IconButton
                icon={Spline}
                label="Add curved text"
                onClick={addCurvedText}
              />
              <IconButton
                icon={ImagePlus}
                label="Add image"
                onClick={() => imageInput.current?.click()}
              />
              <IconButton
                icon={Shapes}
                label="Icon library"
                onClick={() => setDialog("library")}
              />
              <IconButton
                icon={Sparkles}
                label="AI icon generator"
                onClick={() => setDialog("ai")}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <IconButton
                icon={Square}
                label="Add rectangle"
                onClick={() => addShape("rect")}
              />
              <IconButton
                icon={Circle}
                label="Add circle / ellipse"
                onClick={() => addShape("ellipse")}
              />
              <IconButton
                icon={Minus}
                label="Add line"
                onClick={() => addShape("line")}
              />
              <IconButton
                icon={Frame}
                label="Add border (follows the label shape)"
                onClick={() => addShape("frame")}
              />
            </div>
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f)
                  void addImage(f).catch((err: unknown) =>
                    setLastResult(
                      err instanceof Error ? err.message : String(err),
                    ),
                  );
              }}
            />
            {spec.family === "cable" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={design.repeatInWrap}
                  onChange={(e) =>
                    setDesign((d) => ({ ...d, repeatInWrap: e.target.checked }))
                  }
                />
                Repeat flag text along the wrap
              </label>
            )}
            {spec.family === "jewelry" && (
              <p className="text-xs text-neutral-500">
                Design both panels upright. The lower panel prints upside down
                so it reads correctly when folded.
              </p>
            )}
          </section>
          <TemplatesPanel
            current={current}
            onSave={save}
            onLoad={load}
            onDeleted={(id) => current?.id === id && setCurrent(undefined)}
            revision={revision}
          />
        </aside>

        <main className="flex flex-1 flex-col items-center gap-3 overflow-auto p-6">
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <span className="font-medium">{spec.name}</span>
            <div className="flex gap-1" role="group" aria-label="Undo and redo">
              <IconButton
                icon={Undo2}
                label="Undo (Ctrl+Z)"
                size="sm"
                disabled={!canUndo}
                onClick={undo}
              />
              <IconButton
                icon={Redo2}
                label="Redo (Ctrl+Y)"
                size="sm"
                disabled={!canRedo}
                onClick={redo}
              />
            </div>
            <div className="flex gap-1" role="group" aria-label="Preview mode">
              <IconButton
                icon={PencilRuler}
                label="Design view"
                size="sm"
                pressed={view === "design"}
                onClick={() => setView("design")}
              />
              <IconButton
                icon={Printer}
                label="As printed (exact printer dots)"
                size="sm"
                pressed={view === "print"}
                onClick={() => setView("print")}
              />
            </div>
            <label className="flex items-center gap-1">
              Zoom
              <input
                type="range"
                min={4}
                max={20}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            {isBatch && (
              <IconButton
                icon={ChevronLeft}
                label="Previous label in batch"
                disabled={shownIndex === 0}
                onClick={() => step(-1)}
              />
            )}
            <Workspace
              spec={spec}
              design={design}
              preview={preview}
              smooth={smooth}
              view={view}
              selectedIds={selectedIds}
              zoom={zoom}
              onSelect={select}
              onChange={onWorkspaceChange}
            />
            {isBatch && (
              <IconButton
                icon={ChevronRight}
                label="Next label in batch"
                disabled={shownIndex >= records.length - 1}
                onClick={() => step(1)}
              />
            )}
          </div>
          {isBatch && (
            <p className="text-sm font-medium" aria-live="polite">
              Label {shownIndex + 1} of {records.length}
              {shownLabel !== null && (
                <span className="font-normal text-neutral-500">
                  {" "}
                  · &ldquo;{shownLabel}&rdquo;
                </span>
              )}
            </p>
          )}
          {previewError && (
            <p className="text-sm text-red-700">{previewError}</p>
          )}
          <WorkspaceLegend spec={spec} />
          <p className="text-xs text-neutral-500">
            {view === "design"
              ? "Design view: smooth preview. Shift-click to select several; drag snaps to centre and edges (hold Alt to turn snapping off)."
              : "As printed: exact 203 DPI output."}
          </p>
        </main>

        <aside className="space-y-6 border-neutral-200 bg-white p-4 lg:w-80 lg:border-l">
          {single ? (
            <ElementPanel
              element={single}
              spec={spec}
              onChange={updateElement}
              onPatch={patchElement}
              onDelete={removeSelected}
              onDuplicate={duplicateSelected}
              onMove={moveSelected}
            />
          ) : selected.length > 1 ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                  {selected.length} items
                </h2>
                <div className="flex gap-1">
                  <IconButton
                    icon={Copy}
                    label="Duplicate all"
                    size="sm"
                    onClick={duplicateSelected}
                  />
                  <IconButton
                    icon={Trash2}
                    label="Delete all"
                    size="sm"
                    variant="danger"
                    onClick={removeSelected}
                  />
                </div>
              </div>
              <p className="text-xs text-neutral-600">Align as a group</p>
              <div
                className="flex flex-wrap gap-1"
                role="group"
                aria-label="Align group on label"
              >
                {BOX_ALIGN.map((a) => (
                  <IconButton
                    key={a.mode}
                    icon={a.icon}
                    label={a.label}
                    size="sm"
                    onClick={() =>
                      replaceElements(alignGroup(selected, spec, a.mode))
                    }
                  />
                ))}
              </div>
            </section>
          ) : (
            <p className="text-sm text-neutral-500">
              Select an item on the label to edit it.
            </p>
          )}
          <PrintPanel
            key={loads}
            batch={batch}
            onBatch={setBatch}
            copies={copies}
            onCopies={setCopies}
            density={density}
            onDensity={setDensity}
            usesPlaceholder={designUsesBatch(design)}
            state={status.state}
            progress={status.progress}
            onPrint={() => void print()}
            onCancel={() => void session.cancel()}
            lastResult={lastResult}
          />
        </aside>
      </div>

      {dialog === "library" && (
        <IconLibraryDialog
          onClose={() => setDialog(undefined)}
          onPick={(svg, name, key, weight) =>
            addIcon(svg, name, "library", key, weight)
          }
        />
      )}
      {dialog === "ai" && (
        <AiIconDialog
          onClose={() => setDialog(undefined)}
          onPick={(svg, name) => addIcon(svg, name, "ai")}
          onOpenSettings={() => setDialog("ai-settings")}
        />
      )}
      {dialog === "ai-settings" && (
        <AiSettingsDialog onClose={() => setDialog("ai")} />
      )}
    </div>
  );
}
