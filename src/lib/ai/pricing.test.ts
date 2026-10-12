import { describe, expect, it } from "vitest";
import {
  anthropicCost,
  formatUsd,
  monthStart,
  summarize,
  type UsageEntry,
} from "./pricing";

const entry = (over: Partial<UsageEntry>): UsageEntry => ({
  at: 0,
  provider: "anthropic",
  billing: "api-key",
  model: "claude-opus-5-5",
  inputTokens: 0,
  outputTokens: 0,
  prompt: "x",
  kind: "vector",
  ...over,
});

describe("anthropicCost", () => {
  it("prices per million tokens", () => {
    expect(anthropicCost("claude-opus-5-5", 1_000_000, 1_000_000)).toBe(24);
    expect(anthropicCost("claude-sonnet-5-5", 2000, 1000)).toBeCloseTo(
      0.014,
      10,
    );
    expect(anthropicCost("claude-haiku-5-5", 1_000_000, 0)).toBeCloseTo(
      0.1,
      10,
    );
  });

  it("returns undefined for unknown models", () => {
    expect(anthropicCost("claude-mystery", 1, 1)).toBeUndefined();
  });
});

describe("summarize", () => {
  it("totals matching entries and counts unpriced API-key requests", () => {
    const s = summarize(
      [
        entry({ inputTokens: 10, outputTokens: 20, costUsd: 0.5 }),
        entry({ inputTokens: 1, outputTokens: 2, costUsd: 0.25 }),
        entry({ model: "claude-mystery", inputTokens: 5 }),
        entry({
          provider: "openai",
          billing: "chatgpt-plan",
          inputTokens: 100,
        }),
      ],
      (e) => e.provider === "anthropic",
    );
    expect(s).toEqual({
      requests: 3,
      inputTokens: 16,
      outputTokens: 22,
      costUsd: 0.75,
      unpriced: 1,
    });
  });
});

describe("monthStart / formatUsd", () => {
  it("finds the first of the local month", () => {
    const d = new Date(monthStart(new Date(2026, 9, 12, 15, 30)));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([
      2026, 9, 1, 0,
    ]);
  });

  it("shows small amounts with more precision", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.00024)).toBe("$0.0002");
    expect(formatUsd(1.234)).toBe("$1.23");
  });
});
