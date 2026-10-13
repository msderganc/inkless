"use client";

import { LoaderCircle, Settings, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken, isSignedIn } from "~/lib/ai/chatgpt-auth";
import { PROVIDER_NAMES } from "~/lib/ai/models";
import { type UsageEntry } from "~/lib/ai/pricing";
import { BatchError, jobRecords, substitute } from "~/lib/batch";
import { type AiSettings } from "~/lib/store/store";
import { AiSettingsDialog } from "./AiSettingsDialog";
import { useApp } from "./app-context";

const field = "rounded border border-neutral-300 px-2 py-1";

/** Why the app can't use this text, or undefined if it's fine. */
export function checkLabelText(text: string): string | undefined {
  try {
    jobRecords({ kind: "none" }, [text]);
    return undefined;
  } catch (e) {
    return e instanceof BatchError ? e.message : String(e);
  }
}

/** What the text makes: label count plus the first and last label. */
function preview(text: string) {
  const recs = jobRecords({ kind: "none" }, [text]);
  const first = substitute(text, recs[0] ?? null);
  const last = substitute(text, recs[recs.length - 1] ?? null);
  return { count: recs[0] === null ? 1 : recs.length, first, last };
}

const EXAMPLES = [
  "every quarter inch from 1/4 to 2 inches",
  "bins A1 to D5",
  "best by 6 months from today, like Mar 2027",
  "box 1 of 12 through 12 of 12",
  "metric bolts M3 to M10 in 10, 20 and 30 mm lengths",
];

/** "Describe it": the AI writes label text (ranges, lists, dates) from plain words. */
export function DescribeText({
  onUse,
}: {
  onUse: (text: string, mode: "replace" | "insert") => void;
}) {
  const { store } = useApp();
  const [ai, setAi] = useState<AiSettings>();
  const [planReady, setPlanReady] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ text: string; note: string }>();
  const abort = useRef<AbortController | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadAi = useCallback(() => {
    void store.getAiSettings().then(setAi);
    void store.getChatgptAuth().then((a) => setPlanReady(isSignedIn(a)));
  }, [store]);
  useEffect(() => {
    loadAi();
    return () => abort.current?.abort();
  }, [loadAi]);
  const settingsDialog = settingsOpen && (
    <AiSettingsDialog
      onClose={() => {
        setSettingsOpen(false);
        loadAi();
      }}
    />
  );

  const usePlan = ai?.provider === "openai" && ai.openaiAuth === "chatgpt";
  const key = ai
    ? ai.provider === "anthropic"
      ? ai.anthropicKey
      : ai.openaiKey
    : "";
  const ready = usePlan ? planReady : !!key;
  const model = ai
    ? ai.provider === "anthropic"
      ? ai.anthropicModel
      : ai.openaiModel
    : "";

  const log = (u: UsageEntry) => store.logUsage(u).catch(() => undefined);

  const run = async () => {
    if (!ai || !description.trim()) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const { generatePattern } = await import("~/lib/ai/generate");
      const apiKey = usePlan
        ? await getAccessToken(await store.getChatgptAuth(), (a) =>
            store.saveChatgptAuth(a),
          )
        : key;
      const out = await generatePattern(
        { provider: ai.provider, apiKey, model, chatgptPlan: usePlan },
        description,
        checkLabelText,
        ctl.signal,
      );
      await log(out.usage);
      if (!ctl.signal.aborted) setResult(out);
    } catch (e) {
      if (e instanceof Error && "usage" in e && e.usage)
        await log(e.usage as UsageEntry);
      if (!ctl.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  if (ai && !ready)
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-600">
        <Sparkles size={14} aria-hidden />
        <span className="flex-1">
          Describe it with AI: set up{" "}
          {usePlan
            ? "Sign in with ChatGPT"
            : `your ${PROVIDER_NAMES[ai.provider]} key`}{" "}
          first.
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={12} aria-hidden />
          AI settings
        </button>
        {settingsDialog}
      </div>
    );

  const shown = result ? preview(result.text) : undefined;
  return (
    <div className="space-y-2 rounded border border-neutral-200 p-2">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          className={`${field} min-w-0 flex-1 text-sm`}
          placeholder="Describe it, e.g. every 1/4 inch from 1/4 to 2"
          aria-label="Describe the label text"
          maxLength={300}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          type="submit"
          title="Write the label text with AI"
          aria-label="Write the label text with AI"
          disabled={busy || !description.trim()}
          className="text-on-accent inline-flex size-8 items-center justify-center rounded border border-sky-600 bg-sky-600 hover:bg-sky-700 disabled:opacity-40"
        >
          {busy ? (
            <LoaderCircle size={16} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={16} aria-hidden />
          )}
        </button>
      </form>
      {!result && !busy && (
        <div className="flex flex-wrap gap-1">
          {EXAMPLES.map((x) => (
            <button
              key={x}
              type="button"
              className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-700 hover:bg-neutral-100"
              onClick={() => setDescription(x)}
            >
              {x}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {result && shown && (
        <div className="space-y-1.5 text-xs">
          <code className="block rounded bg-neutral-100 px-2 py-1 font-mono text-sm break-all whitespace-pre-wrap text-neutral-900">
            {result.text}
          </code>
          {result.note && <p className="text-neutral-600">{result.note}</p>}
          <p className="text-neutral-600">
            {shown.count === 1
              ? `One label: “${shown.first}”`
              : `${shown.count} labels: “${shown.first}” … “${shown.last}”`}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="text-on-accent rounded border border-sky-600 bg-sky-600 px-2 py-1 font-medium hover:bg-sky-700"
              onClick={() => {
                onUse(result.text, "replace");
                setResult(undefined);
              }}
            >
              Use as the text
            </button>
            <button
              type="button"
              className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
              onClick={() => {
                onUse(result.text, "insert");
                setResult(undefined);
              }}
            >
              Insert at cursor
            </button>
          </div>
        </div>
      )}
      {settingsDialog}
      <p className="text-[11px] text-neutral-500">
        Uses {ai ? `${PROVIDER_NAMES[ai.provider]} · ${model}` : "your AI"}
        {usePlan ? " (ChatGPT plan)" : ""}; logged in AI usage.
      </p>
    </div>
  );
}
