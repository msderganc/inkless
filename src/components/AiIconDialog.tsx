"use client";

import {
  Bookmark,
  BookmarkCheck,
  ChartColumn,
  LoaderCircle,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ChatgptAuthError,
  getAccessToken,
  isSignedIn,
} from "~/lib/ai/chatgpt-auth";
import { PROVIDER_NAMES } from "~/lib/ai/models";
import { type UsageEntry } from "~/lib/ai/pricing";
import { guessIconCategories } from "~/lib/icons";
import { customRect } from "~/lib/catalogue";
import { type DesignElement, emptyDesign, newIcon, newId } from "~/lib/design";
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

/** A generated icon: vector SVG (text models) or a PNG picture (image models). */
export type AiResult =
  { type: "svg"; data: string } | { type: "png"; data: string };

/** The element a result becomes on the label. */
function resultElement(
  r: AiResult,
  x: number,
  y: number,
  size: number,
): DesignElement {
  if (r.type === "svg") return newIcon(r.data, "preview", "ai", x, y, size);
  return {
    id: newId(),
    kind: "image",
    x,
    y,
    w: size,
    h: size,
    rotation: 0,
    src: r.data,
    dither: false,
    threshold: 128,
    invert: false,
    thickness: 0,
  };
}

/** Exactly what the icon prints like at `sizeMm`: rendered through the real 1-bit pipeline. */
function PrintPreview({
  result,
  sizeMm,
}: {
  result: AiResult;
  sizeMm: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [bmp, setBmp] = useState<MonoBitmap>();
  useEffect(() => {
    let live = true;
    const spec = customRect(Math.min(48, sizeMm + 2), sizeMm + 2);
    const design = {
      ...emptyDesign(spec.id),
      elements: [resultElement(result, 1, 1, sizeMm)],
    };
    void renderLabel(design, spec, browserEnv).then(
      (r) => live && setBmp(r.label),
    );
    return () => {
      live = false;
    };
  }, [result, sizeMm]);
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
  onOpenUsage,
}: {
  onClose: () => void;
  onPick: (result: AiResult, name: string) => void;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
}) {
  const { store } = useApp();
  const [ai, setAi] = useState<AiSettings>();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [modelText, setModelText] = useState<string>();
  const [results, setResults] = useState<AiResult[]>([]);
  /** Indexes of results saved to My icons (reset with each generation). */
  const [savedIdx, setSavedIdx] = useState<number[]>([]);
  const [resultsPrompt, setResultsPrompt] = useState("");
  const [resultsCategories, setResultsCategories] = useState<string[]>([]);
  const [sizeMm, setSizeMm] = useState(15);
  const abort = useRef<AbortController | undefined>(undefined);

  const [chatgptEmail, setChatgptEmail] = useState<string>();
  const [chatgptReady, setChatgptReady] = useState(false);

  useEffect(() => {
    void store.getAiSettings().then(setAi);
    void store.getChatgptAuth().then((a) => {
      setChatgptReady(isSignedIn(a));
      setChatgptEmail(a.email);
    });
    return () => abort.current?.abort();
  }, [store]);

  const usePlan = ai?.provider === "openai" && ai.openaiAuth === "chatgpt";
  const key = ai
    ? ai.provider === "anthropic"
      ? ai.anthropicKey
      : ai.openaiKey
    : "";
  const ready = usePlan ? chatgptReady : !!key;
  const imageMode =
    !usePlan && ai?.provider === "openai" && ai.iconStyle === "image";
  const model = ai
    ? ai.provider === "anthropic"
      ? ai.anthropicModel
      : imageMode
        ? ai.openaiImageModel
        : ai.openaiModel
    : "";

  const logUsage = async (entry: UsageEntry) => {
    try {
      await store.logUsage(entry);
    } catch (err) {
      console.warn("Could not record AI usage", err);
    }
  };

  const save = async (result: AiResult, i: number) => {
    try {
      const name = (resultsPrompt || "AI icon").slice(0, 80);
      await store.saveIcon({
        id: newId(),
        name,
        createdAt: Date.now(),
        categories: resultsCategories.length
          ? resultsCategories
          : await guessIconCategories(name),
        ...result,
      });
      setSavedIdx((s) => [...s, i]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const generate = async () => {
    if (!ai) return;
    setBusy(true);
    setError(undefined);
    setModelText(undefined);
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      // Loaded on demand: keeps both AI SDKs out of the main bundle.
      const { generateIcons, generateImageIcons } =
        await import("~/lib/ai/generate");
      const apiKey = usePlan
        ? await getAccessToken(await store.getChatgptAuth(), (a) =>
            store.saveChatgptAuth(a),
          )
        : key;
      const cfg = {
        provider: ai.provider,
        apiKey,
        model,
        chatgptPlan: usePlan,
      };
      const result = imageMode
        ? await generateImageIcons(cfg, prompt, ctl.signal)
        : await generateIcons(cfg, prompt, ctl.signal);
      await logUsage(result.usage);
      const out = result.items.map((data): AiResult =>
        imageMode ? { type: "png", data } : { type: "svg", data },
      );
      if (!ctl.signal.aborted) {
        setResults(out);
        setSavedIdx([]);
        setResultsPrompt(prompt.trim());
        setResultsCategories(result.categories);
      }
    } catch (e) {
      // A refused or unusable answer was still billed: record it.
      if (e instanceof Error && "usage" in e && e.usage)
        await logUsage(e.usage as UsageEntry);
      if (e instanceof ChatgptAuthError && e.signedOut) {
        setChatgptReady(false);
      }
      if (!ctl.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
      // The generate module is loaded lazily, so check the shape rather than the class.
      const text =
        e instanceof Error &&
        "modelText" in e &&
        typeof e.modelText === "string"
          ? e.modelText
          : undefined;
      if (!ctl.signal.aborted && text?.trim()) setModelText(text);
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  return (
    <Modal title="AI icon generator" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {ai && !ready ? (
          <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2">
            <span className="flex-1">
              {usePlan
                ? "Sign in with ChatGPT to generate icons with your plan."
                : `Add your ${PROVIDER_NAMES[ai.provider]} API key to generate icons.`}
            </span>
            <IconButton
              icon={Settings}
              label="Open AI settings"
              onClick={onOpenSettings}
            />
            <IconButton
              icon={ChartColumn}
              label="AI usage and cost"
              onClick={onOpenUsage}
            />
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-neutral-600">
            Using{" "}
            {ai
              ? `${PROVIDER_NAMES[ai.provider]} · ${model}${usePlan ? ` · ChatGPT plan${chatgptEmail ? ` (${chatgptEmail})` : ""}` : ""}`
              : "…"}
            <IconButton
              icon={Settings}
              label="AI settings"
              size="sm"
              onClick={onOpenSettings}
            />
            <IconButton
              icon={ChartColumn}
              label="AI usage and cost"
              size="sm"
              onClick={onOpenUsage}
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
            data-autofocus
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
            disabled={busy || !ready || !prompt.trim()}
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
        {modelText && (
          <details className="text-xs">
            <summary className="cursor-pointer text-neutral-600">
              Show the model&apos;s answer
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-neutral-200 p-2 whitespace-pre-wrap">
              {modelText}
            </pre>
          </details>
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
              {results.map((result, i) => (
                <li key={i}>
                  <button
                    type="button"
                    aria-label={`Use icon ${i + 1}`}
                    title="Add this icon to the label"
                    className="flex w-full flex-col items-center gap-1 rounded border border-neutral-300 p-2 hover:border-sky-500"
                    onClick={() => onPick(result, prompt.trim() || "AI icon")}
                  >
                    <PrintPreview result={result} sizeMm={sizeMm} />
                    <span className="text-xs text-neutral-600">Use this</span>
                  </button>
                  <div className="mt-1 flex justify-center">
                    <IconButton
                      icon={savedIdx.includes(i) ? BookmarkCheck : Bookmark}
                      label={
                        savedIdx.includes(i)
                          ? "Saved to My icons"
                          : `Save icon ${i + 1} to My icons`
                      }
                      size="sm"
                      pressed={savedIdx.includes(i)}
                      disabled={savedIdx.includes(i)}
                      onClick={() => void save(result, i)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
