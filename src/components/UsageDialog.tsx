"use client";

import { ExternalLink, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatUsd,
  monthStart,
  PRICES_AS_OF,
  summarize,
  type UsageEntry,
  type UsageSummary,
} from "~/lib/ai/pricing";
import { useApp } from "./app-context";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

const fmtTokens = (n: number) => n.toLocaleString();

function SummaryCard({ title, s }: { title: string; s: UsageSummary }) {
  return (
    <div className="rounded border border-neutral-200 p-3">
      <p className="text-xs text-neutral-500">{title}</p>
      <p className="text-2xl font-semibold tabular-nums">
        {formatUsd(s.costUsd)}
      </p>
      <p className="text-xs text-neutral-600">
        {s.requests} generation{s.requests === 1 ? "" : "s"} ·{" "}
        {fmtTokens(s.inputTokens)} in / {fmtTokens(s.outputTokens)} out tokens
      </p>
      {s.unpriced > 0 && (
        <p className="text-xs text-amber-700">
          {s.unpriced} with no known price (not included).
        </p>
      )}
    </div>
  );
}

/**
 * Estimated AI spend from the token counts each response reported, priced with Anthropic's
 * list prices. The Anthropic Console is the authoritative bill (it also includes any usage
 * from outside this app).
 */
export function UsageDialog({ onClose }: { onClose: () => void }) {
  const { store } = useApp();
  const [entries, setEntries] = useState<UsageEntry[]>();

  const load = useCallback(
    () => void store.listUsage().then(setEntries),
    [store],
  );
  useEffect(load, [load]);

  const now = new Date();
  const fromMonth = monthStart(now);
  const anthropic = (e: UsageEntry) => e.provider === "anthropic";
  const stats = useMemo(() => {
    const all = entries ?? [];
    return {
      month: summarize(all, (e) => anthropic(e) && e.at >= fromMonth),
      total: summarize(all, anthropic),
      openaiKey: summarize(
        all,
        (e) => e.provider === "openai" && e.billing === "api-key",
      ),
      openaiPlan: summarize(all, (e) => e.billing === "chatgpt-plan"),
    };
  }, [entries, fromMonth]);

  const clear = async () => {
    if (
      !window.confirm(
        "Clear the local usage history? This doesn't affect your provider bills.",
      )
    )
      return;
    await store.clearUsage();
    load();
  };

  return (
    <Modal title="AI usage and cost" onClose={onClose} wide>
      {!entries ? (
        <p className="text-neutral-500">Loading…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Anthropic (your API key)
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryCard
                title={`This month (${now.toLocaleDateString(undefined, { month: "long" })})`}
                s={stats.month}
              />
              <SummaryCard title="All time (in this app)" s={stats.total} />
            </div>
            <p className="flex items-center gap-1 text-xs text-neutral-500">
              Estimated from tokens × Anthropic list prices ({PRICES_AS_OF}).
              Your exact bill is in the
              <a
                className="inline-flex items-center gap-0.5 text-sky-700 underline"
                href="https://console.anthropic.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                Anthropic Console
                <ExternalLink size={12} aria-hidden />
              </a>
            </p>
          </section>

          {(stats.openaiKey.requests > 0 || stats.openaiPlan.requests > 0) && (
            <section className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                OpenAI
              </h3>
              {stats.openaiKey.requests > 0 && (
                <p className="text-xs text-neutral-600">
                  API key: {stats.openaiKey.requests} generations ·{" "}
                  {fmtTokens(stats.openaiKey.inputTokens)} in /{" "}
                  {fmtTokens(stats.openaiKey.outputTokens)} out tokens (see your
                  OpenAI dashboard for cost)
                </p>
              )}
              {stats.openaiPlan.requests > 0 && (
                <p className="text-xs text-neutral-600">
                  ChatGPT plan: {stats.openaiPlan.requests} generations
                  (included in your plan&apos;s allowance)
                </p>
              )}
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                Recent generations
              </h3>
              {entries.length > 0 && (
                <IconButton
                  icon={Trash2}
                  label="Clear usage history"
                  size="sm"
                  variant="danger"
                  onClick={() => void clear()}
                />
              )}
            </div>
            {entries.length === 0 ? (
              <p className="text-neutral-500">No AI requests yet.</p>
            ) : (
              <div className="max-h-72 overflow-auto rounded border border-neutral-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-600">
                    <tr>
                      <th className="px-2 py-1 font-medium">When</th>
                      <th className="px-2 py-1 font-medium">Request</th>
                      <th className="px-2 py-1 font-medium">Model</th>
                      <th className="px-2 py-1 text-right font-medium">
                        Tokens in/out
                      </th>
                      <th className="px-2 py-1 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.slice(0, 200).map((e, i) => (
                      <tr
                        key={`${e.at}-${i}`}
                        className="border-t border-neutral-200"
                      >
                        <td className="px-2 py-1 whitespace-nowrap">
                          {new Date(e.at).toLocaleString(undefined, {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </td>
                        <td
                          className="max-w-[12rem] truncate px-2 py-1"
                          title={e.prompt}
                        >
                          {e.prompt}
                        </td>
                        <td className="px-2 py-1 font-mono">{e.model}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {fmtTokens(e.inputTokens)} /{" "}
                          {fmtTokens(e.outputTokens)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {e.billing === "chatgpt-plan"
                            ? "plan"
                            : e.costUsd !== undefined
                              ? formatUsd(e.costUsd)
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
