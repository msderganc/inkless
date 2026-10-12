"use client";

import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  PencilRuler,
  Printer,
  Type,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BatchSpec, batchValues } from "~/lib/batch";
import {
  type Design,
  type DesignElement,
  designUsesBatch,
  emptyDesign,
  type ImageElement,
  newId,
  newText,
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
import { useApp, useSessionStatus } from "./app-context";
import { ElementPanel } from "./ElementPanel";
import { LabelPicker } from "./LabelPicker";
import { PrintPanel } from "./PrintPanel";
import { StatusBar } from "./StatusBar";
import { TemplatesPanel } from "./TemplatesPanel";
import { IconButton } from "./IconButton";
import { DEFAULT_ZOOM, Workspace, WorkspaceLegend } from "./Workspace";

const DEFAULT_LABEL = "rect-50x30";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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

  const [design, setDesign] = useState<Design>(
    () => draft?.design ?? emptyDesign(initialLabel),
  );
  const [selectedId, setSelectedId] = useState<string>();
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
  const selected = design.elements.find((e) => e.id === selectedId);
  // Batch values for stepping through the preview ([null] when not a batch or invalid).
  const values = useMemo(() => {
    try {
      return batchValues(batch);
    } catch {
      return [null];
    }
  }, [batch]);
  const isBatch = values.length > 1 || values[0] !== null;
  const [previewIndex, setPreviewIndex] = useState(0);
  const shownIndex = Math.min(previewIndex, values.length - 1);
  const previewValue = values[shownIndex] ?? null;
  const step = useCallback(
    (delta: number) =>
      setPreviewIndex((i) =>
        Math.max(
          0,
          Math.min(values.length - 1, Math.min(i, values.length - 1) + delta),
        ),
      ),
    [values.length],
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
                batchValue: previewValue,
              },
            ).then((c) => {
              if (seq !== renderSeq.current) return;
              setSmooth(c);
            })
          : renderLabel(design, spec, browserEnv, {
              batchValue: previewValue,
              offsetDots: settings.offsetDots,
            }).then((r) => {
              if (seq !== renderSeq.current) return;
              setPreview(r.label);
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
  }, [design, spec, previewValue, settings.offsetDots, view, zoom]);

  const updateElement = useCallback((el: DesignElement) => {
    setDesign((d) => ({
      ...d,
      elements: d.elements.map((e) => (e.id === el.id ? el : e)),
    }));
  }, []);
  // Merge into the latest state so quick successive edits (e.g. italic then underline) all stick.
  const patchElement = useCallback(
    (id: string, patch: Partial<DesignElement>) => {
      setDesign((d) => ({
        ...d,
        elements: d.elements.map((e) =>
          e.id === id ? ({ ...e, ...patch } as DesignElement) : e,
        ),
      }));
    },
    [],
  );

  const addElement = (el: DesignElement) => {
    setDesign((d) => ({ ...d, elements: [...d.elements, el] }));
    setSelectedId(el.id);
  };

  const addText = () => {
    const m = 2;
    addElement(
      newText(
        m,
        m,
        Math.max(4, spec.widthMm - 2 * m),
        Math.max(4, Math.min(10, spec.heightMm - 2 * m)),
      ),
    );
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
    const el: ImageElement = {
      id: newId(),
      kind: "image",
      x: (spec.widthMm - size) / 2,
      y: (spec.heightMm - size) / 2,
      w: size,
      h: size,
      rotation: 0,
      src,
      dither: false,
      threshold: 128,
      invert: false,
    };
    addElement(el);
  };

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setDesign((d) => ({
      ...d,
      elements: d.elements.filter((e) => e.id !== selectedId),
    }));
    setSelectedId(undefined);
  }, [selectedId]);

  const moveSelected = (dir: "up" | "down") =>
    setDesign((d) => {
      const i = d.elements.findIndex((e) => e.id === selectedId);
      const j = dir === "up" ? i + 1 : i - 1;
      if (i < 0 || j < 0 || j >= d.elements.length) return d;
      const els = [...d.elements];
      [els[i], els[j]] = [els[j]!, els[i]!];
      return { ...d, elements: els };
    });

  // Keyboard: Delete removes, arrows nudge 0.25 mm (Shift = 1 mm).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!selected || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
        return;
      const step = e.shiftKey ? 1 : 0.25;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
      } else if (moves[e.key]) {
        e.preventDefault();
        const [dx, dy] = moves[e.key]!;
        updateElement({ ...selected, x: selected.x + dx, y: selected.y + dy });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, removeSelected, updateElement]);

  const changeLabel = (labelId: string) => {
    setDesign((d) => (d.labelId === labelId ? d : { ...d, labelId }));
    if (labelId !== settings.lastLabelId)
      void updateSettings({ lastLabelId: labelId });
  };

  const print = async () => {
    setLastResult(undefined);
    let values: (string | null)[];
    try {
      values = batchValues(batch);
    } catch (e) {
      setLastResult(e instanceof Error ? e.message : String(e));
      return;
    }
    const printDesign = design;
    const printSpec = spec;
    try {
      const out = await session.print({
        pageCount: values.length,
        copies,
        density,
        labelType: labelTypeFor(printSpec.stock),
        renderPage: async (i) =>
          encodeForPrinter(
            (
              await renderLabel(printDesign, printSpec, browserEnv, {
                batchValue: values[i] ?? null,
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
    setSelectedId(undefined);
    changeLabel(t.design.labelId);
  };

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
            <div className="flex gap-2">
              <IconButton icon={Type} label="Add text" onClick={addText} />
              <IconButton
                icon={ImagePlus}
                label="Add image"
                onClick={() => imageInput.current?.click()}
              />
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
            </div>
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
          <div className="flex items-center gap-4 text-sm">
            <span className="font-medium">{spec.name}</span>
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
              selectedId={selectedId}
              zoom={zoom}
              onSelect={setSelectedId}
              onChange={updateElement}
            />
            {isBatch && (
              <IconButton
                icon={ChevronRight}
                label="Next label in batch"
                disabled={shownIndex >= values.length - 1}
                onClick={() => step(1)}
              />
            )}
          </div>
          {isBatch && (
            <p className="text-sm font-medium" aria-live="polite">
              Label {shownIndex + 1} of {values.length}
              {previewValue !== null && (
                <span className="font-normal text-neutral-500">
                  {" "}
                  · &ldquo;{previewValue}&rdquo;
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
              ? "Design view: smooth preview. Switch to As printed to see the exact printer dots."
              : "As printed: exact 203 DPI output."}
          </p>
        </main>

        <aside className="space-y-6 border-neutral-200 bg-white p-4 lg:w-80 lg:border-l">
          {selected ? (
            <ElementPanel
              element={selected}
              spec={spec}
              onChange={updateElement}
              onPatch={patchElement}
              onDelete={removeSelected}
              onDuplicate={() =>
                addElement({
                  ...selected,
                  id: newId(),
                  x: selected.x + 1,
                  y: selected.y + 1,
                })
              }
              onMove={moveSelected}
            />
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
    </div>
  );
}
