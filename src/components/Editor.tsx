"use client";

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  FilePlus,
  Maximize,
  Redo2,
  Save,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alignGroup, alignmentArea } from "~/lib/align";
import { type BatchSpec, jobRecords, recordLabel } from "~/lib/batch";
import {
  type DesignElement,
  designTexts,
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
import { type AiResult, AiIconDialog } from "./AiIconDialog";
import { AiSettingsDialog } from "./AiSettingsDialog";
import { UsageDialog } from "./UsageDialog";
import { useApp, useSessionStatus } from "./app-context";
import { BOX_ALIGN, ElementPanel } from "./ElementPanel";
import { IconButton } from "./IconButton";
import { IconLibraryDialog } from "./IconLibraryDialog";
import { LabelPicker } from "./LabelPicker";
import { PrintBar, PrintSettings } from "./PrintPanel";
import { StatusBar } from "./StatusBar";
import { TemplatesPanel } from "./TemplatesPanel";
import { useDesignHistory } from "./useDesignHistory";
import {
  ACTUAL_SIZE_ZOOM,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  Workspace,
  WorkspaceLegend,
} from "./Workspace";
import { type AddTool, AddTools } from "./AddTools";
import { LayersPanel } from "./LayersPanel";
import { Tip } from "./Tip";
import { findFreeSpot } from "~/lib/place";

const DEFAULT_LABEL = "rect-50x30";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type Dialog =
  "library" | "my-icons" | "ai" | "ai-settings" | "usage" | undefined;

export default function Editor() {
  const {
    store,
    session,
    settings,
    updateSettings,
    overrides,
    initialDraft,
    connectPrinter,
  } = useApp();
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
    seal,
    reset: resetHistory,
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
  /** Zoom follows the canvas size until the user zooms by hand. */
  const [zoomFit, setZoomFit] = useState(draft?.zoomFit ?? true);
  const [fitZoom, setFitZoom] = useState(DEFAULT_ZOOM);
  const [dialog, setDialog] = useState<Dialog>();
  const [docName, setDocName] = useState(draft?.template?.name ?? "");
  const [saveMessage, setSaveMessage] = useState<{
    ok: boolean;
    text: string;
  }>();
  const [tab, setTab] = useState<"design" | "print">("design");
  const nameInput = useRef<HTMLInputElement>(null);
  const canvasArea = useRef<HTMLDivElement>(null);
  const [autosaveError, setAutosaveError] = useState<string>();

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
      zoomFit,
      savedAt: Date.now(),
    };
    const t = setTimeout(() => {
      if (latestDraft.current)
        void store
          .saveDraft(latestDraft.current)
          .then(() => setAutosaveError(undefined))
          .catch((e: unknown) =>
            setAutosaveError(e instanceof Error ? e.message : String(e)),
          );
    }, 400);
    return () => clearTimeout(t);
  }, [store, design, batch, density, copies, current, view, zoom, zoomFit]);
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
      return jobRecords(batch, designTexts(design));
    } catch {
      return [null];
    }
  }, [batch, design]);
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

  // Fit: the largest zoom at which the whole label fits the canvas area.
  useEffect(() => {
    const el = canvasArea.current;
    if (!el) return;
    const measure = () => {
      const side = isBatch ? 104 : 0; // batch arrows beside the label
      const w = el.clientWidth - 64 - side;
      const h = el.clientHeight - 48;
      const z = Math.min(w / spec.widthMm, h / spec.heightMm);
      if (Number.isFinite(z) && z > 0)
        setFitZoom(
          Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(z * 4) / 4)),
        );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spec.widthMm, spec.heightMm, isBatch]);
  const shownZoom = zoomFit ? fitZoom : zoom;
  const zoomBy = (factor: number) => {
    const next = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.round(shownZoom * factor * 4) / 4),
    );
    setZoom(next);
    setZoomFit(false);
  };
  const zoomPercent = Math.round((shownZoom / ACTUAL_SIZE_ZOOM) * 100);

  // Selecting something shows its settings.
  useEffect(() => {
    if (selectedIds.length > 0) setTab("design");
  }, [selectedIds]);

  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    if (!("fonts" in document)) return;
    const bump = () => setFontEpoch((n) => n + 1);
    document.fonts.addEventListener("loadingdone", bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, []);

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
              shownZoom * (window.devicePixelRatio || 1),
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
  }, [
    design,
    spec,
    previewRecord,
    settings.offsetDots,
    view,
    shownZoom,
    fontEpoch,
  ]);

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
  /** Like centredBox, but moved off existing items when the centre is taken. */
  const freeBox = (w: number, h: number) => {
    const c = centredBox(w, h);
    const others = design.elements.filter(
      (e) => !e.hidden && !(e.kind === "shape" && e.shape === "frame"),
    );
    const p = findFreeSpot(c.w, c.h, c.area, others);
    return { ...c, ...p };
  };

  const addText = () => {
    const b = freeBox(spec.widthMm, 10);
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
    const b = freeBox(
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
    const b = freeBox(size, size);
    addElement({
      ...newIcon(svg, name, source, b.x, b.y, Math.min(b.w, b.h)),
      libraryKey,
      weight,
    });
    setDialog(undefined);
  };

  /** An AI result or saved icon: SVG → icon element; PNG → 1-bit thresholded image. */
  const addAiResult = (result: AiResult, name: string) => {
    if (result.type === "svg") {
      addIcon(result.data, name, "ai");
      return;
    }
    const size = Math.min(spec.widthMm, spec.heightMm) * 0.6;
    const b = freeBox(size, size);
    addElement({
      id: newId(),
      kind: "image",
      x: b.x,
      y: b.y,
      w: Math.min(b.w, b.h),
      h: Math.min(b.w, b.h),
      rotation: 0,
      src: result.data,
      dither: false,
      threshold: 128,
      invert: false,
      thickness: 0,
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
    const b = freeBox(size, size);
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
      thickness: 0,
    };
    addElement(el);
  };

  const removeIds = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setDesign((d) => ({
        ...d,
        elements: d.elements.filter((e) => !ids.includes(e.id)),
      }));
      setSelectedIds((sel) => sel.filter((id) => !ids.includes(id)));
    },
    [setDesign],
  );
  /** Delete buttons: everything selected (an explicit choice, even if locked). */
  const removeSelected = useCallback(
    () => removeIds(selectedIds),
    [removeIds, selectedIds],
  );

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

  const reorder = (id: string | undefined, dir: "up" | "down") =>
    setDesign((d) => {
      const i = d.elements.findIndex((e) => e.id === id);
      const j = dir === "up" ? i + 1 : i - 1;
      if (i < 0 || j < 0 || j >= d.elements.length) return d;
      const els = [...d.elements];
      [els[i], els[j]] = [els[j]!, els[i]!];
      return { ...d, elements: els };
    });
  const moveSelected = (dir: "up" | "down") => reorder(single?.id, dir);

  const onAdd = (tool: AddTool) => {
    switch (tool) {
      case "text":
        return addText();
      case "curved":
        return addCurvedText();
      case "image":
        return imageInput.current?.click();
      case "library":
      case "my-icons":
      case "ai":
        return setDialog(tool);
      default:
        return addShape(tool);
    }
  };

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
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        void saveRef.current(false);
        return;
      }
      if (typing || document.querySelector("dialog[open]")) return; // native undo in fields; dialogs own keys
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && k === "a") {
        e.preventDefault();
        // Only what you can see and move.
        setSelectedIds(
          design.elements
            .filter((x) => !x.hidden && !x.locked)
            .map((x) => x.id),
        );
      } else if (mod && k === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (
        selected.length &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        // The keyboard never deletes locked items.
        removeIds(selected.filter((x) => !x.locked).map((x) => x.id));
      } else if (e.key === "Escape") {
        setSelectedIds([]);
      } else if (selected.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const movable = selected.filter((x) => !x.locked && !x.hidden);
        if (movable.length === 0) return; // no empty undo steps
        const s = e.shiftKey ? 1 : 0.25;
        const [dx, dy] = {
          ArrowLeft: [-s, 0],
          ArrowRight: [s, 0],
          ArrowUp: [0, -s],
          ArrowDown: [0, s],
        }[e.key] ?? [0, 0];
        replaceElements(
          movable.map((x) => ({ ...x, x: x.x + dx!, y: x.y + dy! })),
          `nudge:${movable.map((x) => x.id).join(",")}`,
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selected,
    design.elements,
    removeIds,
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
    let recs: ReturnType<typeof jobRecords>;
    try {
      recs = jobRecords(batch, designTexts(design));
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

  /** Save (over the open label, or as a new one). Needs a name. */
  const save = async (asNew: boolean) => {
    const name = docName.trim();
    if (!name) {
      setSaveMessage({ ok: false, text: "Give the label a name first." });
      nameInput.current?.focus();
      return;
    }
    try {
      const base = newTemplate(name, design, batch, density, copies);
      const t: Template =
        current && !asNew ? { ...base, id: current.id } : base;
      await store.saveTemplate(t);
      setCurrent({ id: t.id, name });
      setRevision((r) => r + 1);
      setSaveMessage({
        ok: true,
        text: asNew || !current ? `Saved as “${name}”.` : "Saved.",
      });
    } catch (e) {
      setSaveMessage({
        ok: false,
        text: `Couldn't save: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  // Success messages fade after a few seconds.
  useEffect(() => {
    if (!saveMessage?.ok) return;
    const t = setTimeout(() => setSaveMessage(undefined), 3000);
    return () => clearTimeout(t);
  }, [saveMessage]);

  const load = (t: Template) => {
    if (!resolveLabel(t.design.labelId, overrides)) {
      setLastResult(
        `"${t.name}" uses an unknown label (${t.design.labelId}). Pick the label before printing.`,
      );
    }
    setLoads((n) => n + 1);
    resetHistory(t.design);
    setBatch(t.batch);
    setDensity(t.density);
    setCopies(t.copies);
    setCurrent({ id: t.id, name: t.name });
    setDocName(t.name);
    setSaveMessage(undefined);
    setSelectedIds([]);
    changeLabel(t.design.labelId);
  };

  /** Start over on a blank label of the same size (undo brings the old design back). */
  const newLabel = () => {
    if (
      design.elements.length > 0 &&
      !window.confirm(
        "Start a new blank label? The current design will be cleared (Undo brings it back).",
      )
    )
      return;
    setDesign({
      ...emptyDesign(design.labelId),
      repeatInWrap: design.repeatInWrap,
    });
    setBatch({ kind: "none" });
    setLoads((n) => n + 1);
    setCurrent(undefined);
    setDocName("");
    setSaveMessage(undefined);
    setSelectedIds([]);
    setLastResult(undefined);
  };

  const shownLabel = recordLabel(batch, previewRecord);

  const tabButton = (t: "design" | "print", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      className={`flex-1 border-b-2 px-3 py-2 text-sm font-medium ${
        tab === t
          ? "border-sky-600 text-sky-700"
          : "border-transparent text-neutral-600 hover:text-neutral-900"
      }`}
      onClick={() => setTab(t)}
    >
      {label}
    </button>
  );
  const segment = (active: boolean) =>
    `px-3 py-1 text-sm ${
      active
        ? "bg-neutral-800 text-white"
        : "bg-white text-neutral-700 hover:bg-neutral-100"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-100 text-neutral-900 lg:h-screen lg:min-h-0">
      <StatusBar page="editor" />
      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        <aside className="space-y-6 border-neutral-200 bg-white p-4 lg:w-72 lg:overflow-y-auto lg:border-r">
          <LabelPicker labelId={design.labelId} onChange={changeLabel} />
          <section className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Add
            </h2>
            <AddTools onAdd={onAdd} />
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
            onLoad={load}
            onDeleted={(id) => {
              if (current?.id === id) setCurrent(undefined);
            }}
            revision={revision}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 bg-white px-4 py-2">
            <input
              ref={nameInput}
              className="w-56 min-w-0 rounded border border-neutral-300 px-2 py-1 text-sm font-medium"
              placeholder="Untitled label"
              aria-label="Label name"
              maxLength={200}
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save(false);
              }}
            />
            <button
              type="button"
              className="text-on-accent inline-flex items-center gap-1.5 rounded border border-sky-600 bg-sky-600 px-3 py-1 text-sm font-medium hover:bg-sky-700"
              title={
                current
                  ? `Save changes to "${current.name}" (Ctrl+S)`
                  : "Save this label (Ctrl+S)"
              }
              onClick={() => void save(false)}
            >
              <Save size={15} aria-hidden />
              Save
            </button>
            {current && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
                title="Save a copy under the name above"
                onClick={() => void save(true)}
              >
                <CopyPlus size={15} aria-hidden />
                Save as new
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
              title="Start a blank label of the same size"
              onClick={newLabel}
            >
              <FilePlus size={15} aria-hidden />
              New
            </button>
            {saveMessage && (
              <span
                role="status"
                className={`text-xs ${saveMessage.ok ? "text-emerald-700" : "text-red-700"}`}
              >
                {saveMessage.text}
              </span>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <div
                className="flex gap-1"
                role="group"
                aria-label="Undo and redo"
              >
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
              <div
                className="flex overflow-hidden rounded border border-neutral-300"
                role="group"
                aria-label="Preview mode"
              >
                <button
                  type="button"
                  aria-pressed={view === "design"}
                  className={segment(view === "design")}
                  title="Smooth preview for designing"
                  onClick={() => setView("design")}
                >
                  Design
                </button>
                <button
                  type="button"
                  aria-pressed={view === "print"}
                  className={segment(view === "print")}
                  title="The exact printer dots (203 DPI)"
                  onClick={() => setView("print")}
                >
                  As printed
                </button>
              </div>
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label="Zoom"
              >
                <IconButton
                  icon={ZoomOut}
                  label="Zoom out"
                  size="sm"
                  disabled={shownZoom <= MIN_ZOOM}
                  onClick={() => zoomBy(1 / 1.25)}
                />
                <button
                  type="button"
                  className="w-14 rounded px-1 py-1 text-center text-sm tabular-nums hover:bg-neutral-100"
                  title="Actual size (100%)"
                  onClick={() => {
                    setZoom(ACTUAL_SIZE_ZOOM);
                    setZoomFit(false);
                  }}
                >
                  {zoomPercent}%
                </button>
                <IconButton
                  icon={ZoomIn}
                  label="Zoom in"
                  size="sm"
                  disabled={shownZoom >= MAX_ZOOM}
                  onClick={() => zoomBy(1.25)}
                />
                <IconButton
                  icon={Maximize}
                  label="Fit to window"
                  size="sm"
                  pressed={zoomFit}
                  onClick={() => setZoomFit(true)}
                />
              </div>
            </div>
          </div>

          <div
            ref={canvasArea}
            className="flex min-h-[50vh] flex-1 items-center justify-center gap-3 overflow-auto p-6 lg:min-h-0"
          >
            {isBatch && (
              <IconButton
                icon={ChevronLeft}
                label="Previous label in batch"
                disabled={shownIndex === 0}
                onClick={() => step(-1)}
              />
            )}
            <div className="m-auto">
              <Workspace
                spec={spec}
                design={design}
                preview={preview}
                smooth={smooth}
                view={view}
                selectedIds={selectedIds}
                zoom={shownZoom}
                onSelect={select}
                onChange={onWorkspaceChange}
                onGestureEnd={seal}
              />
            </div>
            {isBatch && (
              <IconButton
                icon={ChevronRight}
                label="Next label in batch"
                disabled={shownIndex >= records.length - 1}
                onClick={() => step(1)}
              />
            )}
          </div>

          <div className="flex flex-col items-center gap-2 px-4 pb-4">
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
            {autosaveError && (
              <p className="text-sm text-red-700" role="alert">
                Your work isn&apos;t being saved: {autosaveError}
              </p>
            )}
            {previewError && (
              <p className="text-sm text-red-700">{previewError}</p>
            )}
            <WorkspaceLegend spec={spec} />
            {view === "design" ? (
              <Tip id="canvas-basics">
                Drag items to move them; they snap to the centre and edges (hold
                Alt to place freely). Shift-click selects several. Arrow keys
                nudge (Shift for 1 mm). Ctrl+S saves.
              </Tip>
            ) : (
              <p className="text-xs text-neutral-500">
                Showing the exact printer dots (203 DPI). Switch to Design to
                edit.
              </p>
            )}
          </div>
        </main>

        <aside className="flex flex-col border-neutral-200 bg-white lg:min-h-0 lg:w-80 lg:border-l">
          <div className="flex border-b border-neutral-200" role="tablist">
            {tabButton("design", "Design")}
            {tabButton("print", "Print settings")}
          </div>
          <div className="flex-1 space-y-6 p-4 lg:min-h-0 lg:overflow-y-auto">
            {tab === "design" ? (
              <>
                <section className="space-y-2">
                  <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                    Layers
                  </h2>
                  <LayersPanel
                    elements={design.elements}
                    selectedIds={selectedIds}
                    onSelect={(id, additive) => select(id, additive)}
                    onPatch={patchElement}
                    onReorder={reorder}
                  />
                </section>
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
                            replaceElements(
                              alignGroup(
                                selected.filter((x) => !x.locked && !x.hidden),
                                spec,
                                a.mode,
                              ),
                            )
                          }
                        />
                      ))}
                    </div>
                  </section>
                ) : (
                  design.elements.length > 0 && (
                    <p className="text-sm text-neutral-500">
                      Select an item on the label or in Layers to edit it.
                    </p>
                  )
                )}
              </>
            ) : (
              <PrintSettings
                key={loads}
                batch={batch}
                onBatch={setBatch}
                copies={copies}
                onCopies={setCopies}
                density={density}
                onDensity={setDensity}
                usesPlaceholder={designUsesBatch(design)}
                texts={designTexts(design)}
              />
            )}
          </div>
          <div className="sticky bottom-0 border-t border-neutral-200 bg-white p-4">
            <PrintBar
              batch={batch}
              texts={designTexts(design)}
              copies={copies}
              state={status.state}
              progress={status.progress}
              error={status.error}
              onPrint={() => void print()}
              onCancel={() => void session.cancel()}
              onConnect={() => void connectPrinter()}
              lastResult={lastResult}
            />
          </div>
        </aside>
      </div>

      {(dialog === "library" || dialog === "my-icons") && (
        <IconLibraryDialog
          initialMine={dialog === "my-icons"}
          onClose={() => setDialog(undefined)}
          onPick={(svg, name, key, weight) =>
            addIcon(svg, name, "library", key, weight)
          }
          onPickSaved={(icon) => addAiResult(icon, icon.name)}
        />
      )}
      {dialog === "ai" && (
        <AiIconDialog
          onClose={() => setDialog(undefined)}
          onPick={addAiResult}
          onOpenSettings={() => setDialog("ai-settings")}
          onOpenUsage={() => setDialog("usage")}
        />
      )}
      {dialog === "ai-settings" && (
        <AiSettingsDialog onClose={() => setDialog("ai")} />
      )}
      {dialog === "usage" && <UsageDialog onClose={() => setDialog("ai")} />}
    </div>
  );
}
