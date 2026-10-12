"use client";

import { LoaderCircle, Settings, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PROVIDER_NAMES } from "~/lib/ai/models";
import { customRect } from "~/lib/catalogue";
import { emptyDesign, newIcon } from "~/lib/design";
import { browserEnv } from "~/lib/render/browser-env";
import { type MonoBitmap } from "~/lib/render/mono";
import { renderLabel } from "~/lib/render/render";
import { type AiSettings } from "~/lib/store/store";
import { useApp } from "./app-context";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

const EXAMPLES = [
  "sleeping cat",
  "strawberry",
  "rocket",
  "paw print",
  "coffee cup",
  "star with a smile",
];

/** Exactly what the icon prints like at `sizeMm`: rendered through the real 1-bit pipeline. */
function PrintPreview({ svg, sizeMm }: { svg: string; sizeMm: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [bmp, setBmp] = useState<MonoBitmap>();
  useEffect(() => {
    let live = true;
    const spec = customRect(Math.min(48, sizeMm + 2), sizeMm + 2);
    const design = {
      ...emptyDesign(spec.id),
      elements: [newIcon(svg, "preview", "ai", 1, 1, sizeMm)],
    };
    void renderLabel(design, spec, browserEnv).then(
      (r) => live && setBmp(r.label),
    );
    return () => {
      live = false;
    };
  }, [svg, sizeMm]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !bmp) return;
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(bmp.width, bmp.height);
    for (let i = 0; i < bmp.data.length; i++) {
      const v = bmp.data[i] ? 20 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [bmp]);
  return (
    <canvas
      ref={ref}
      className="bg-paper size-28"
      style={{ imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}

/** Generate print-ready black-and-white icons with Anthropic or OpenAI. */
export function AiIconDialog({
  onClose,
  onPick,
  onOpenSettings,
}: {
  onClose: () => void;
  onPick: (svg: string, name: string) => void;
  onOpenSettings: () => void;
}) {
  const { store } = useApp();
  const [ai, setAi] = useState<AiSettings>();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<string[]>([]);
  const [sizeMm, setSizeMm] = useState(15);
  const abort = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    void store.getAiSettings().then(setAi);
    return () => abort.current?.abort();
  }, [store]);

  const key = ai
    ? ai.provider === "anthropic"
      ? ai.anthropicKey
      : ai.openaiKey
    : "";
  const model = ai
    ? ai.provider === "anthropic"
      ? ai.anthropicModel
      : ai.openaiModel
    : "";

  const generate = async () => {
    if (!ai) return;
    setBusy(true);
    setError(undefined);
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      // Loaded on demand: keeps both AI SDKs out of the main bundle.
      const { generateIcons } = await import("~/lib/ai/generate");
      const svgs = await generateIcons(
        { provider: ai.provider, apiKey: key, model },
        prompt,
        ctl.signal,
      );
      if (!ctl.signal.aborted) setResults(svgs);
    } catch (e) {
      if (!ctl.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  return (
    <Modal title="AI icon generator" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {ai && !key ? (
          <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2">
            <span className="flex-1">
              Add your {PROVIDER_NAMES[ai.provider]} API key to generate icons.
            </span>
            <IconButton
              icon={Settings}
              label="Open AI settings"
              onClick={onOpenSettings}
            />
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-neutral-600">
            Using {ai ? `${PROVIDER_NAMES[ai.provider]} · ${model}` : "…"}
            <IconButton
              icon={Settings}
              label="AI settings"
              size="sm"
              onClick={onOpenSettings}
            />
          </p>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <input
            autoFocus
            className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-1.5"
            placeholder="Describe an icon, e.g. a sleeping cat"
            aria-label="Icon description"
            maxLength={300}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <IconButton
            icon={busy ? LoaderCircle : Sparkles}
            label={busy ? "Generating…" : "Generate 4 icons"}
            variant="primary"
            disabled={busy || !key || !prompt.trim()}
            onClick={() => void generate()}
          />
        </form>
        <div className="flex flex-wrap gap-1 text-xs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="rounded-full border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100"
              onClick={() => setPrompt(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500">
          Icons are made as bold black shapes on white, with no greys or fine
          detail, so they print cleanly. Previews show the exact printed dots.
        </p>
        {busy && (
          <p role="status" className="text-neutral-600">
            Designing icons… this can take 20–60 seconds.
          </p>
        )}
        {error && (
          <p className="text-red-700" role="alert">
            {error}
          </p>
        )}

        {results.length > 0 && (
          <>
            <label className="flex items-center gap-2 text-xs">
              Preview size {sizeMm} mm
              <input
                type="range"
                min={8}
                max={30}
                value={sizeMm}
                onChange={(e) => setSizeMm(Number(e.target.value))}
              />
            </label>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {results.map((svg, i) => (
                <li key={i}>
                  <button
                    type="button"
                    aria-label={`Use icon ${i + 1}`}
                    title="Add this icon to the label"
                    className="flex w-full flex-col items-center gap-1 rounded border border-neutral-300 p-2 hover:border-sky-500"
                    onClick={() => onPick(svg, prompt.trim() || "AI icon")}
                  >
                    <PrintPreview svg={svg} sizeMm={sizeMm} />
                    <span className="text-xs text-neutral-600">Use this</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
