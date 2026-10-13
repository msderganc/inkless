/**
 * Anthropic list prices (USD per million tokens), standard tier, from the Claude API reference
 * cached 2026-10-06. Used to estimate the cost of icon generations from the token counts each
 * response reports; the Anthropic Console remains the authoritative bill.
 */
export const ANTHROPIC_PRICES: Record<
  string,
  { input: number; output: number }
> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  // Prompts up to 100K tokens (icon requests are far smaller).
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export const PRICES_AS_OF = "2026-10-06";

export interface UsageEntry {
  /** ms since epoch. */
  at: number;
  provider: "anthropic" | "openai";
  /** How it was paid for. */
  billing: "api-key" | "chatgpt-plan";
  /** Model that actually served the request (may differ from the requested one on fallback). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD cost, when the model's price is known; undefined otherwise. */
  costUsd?: number;
  /** What was asked for (trimmed), for the history list. */
  prompt: string;
  /** vector/image icons, or "text" (e.g. a described range or date). */
  kind: "vector" | "image" | "text";
}

/** Estimated cost of one Anthropic request, or undefined for an unknown model. */
export function anthropicCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const p = ANTHROPIC_PRICES[model];
  if (!p) return undefined;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Requests whose cost couldn't be estimated (unknown model). */
  unpriced: number;
}

export function summarize(
  entries: UsageEntry[],
  filter: (e: UsageEntry) => boolean = () => true,
): UsageSummary {
  const s: UsageSummary = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    unpriced: 0,
  };
  for (const e of entries) {
    if (!filter(e)) continue;
    s.requests++;
    s.inputTokens += e.inputTokens;
    s.outputTokens += e.outputTokens;
    if (e.costUsd === undefined) {
      if (e.billing === "api-key") s.unpriced++;
    } else s.costUsd += e.costUsd;
  }
  return s;
}

/** Start of the calendar month containing `now`, local time. */
export function monthStart(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}
