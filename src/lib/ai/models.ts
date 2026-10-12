/** Provider and model choices (kept separate from generate.ts so it doesn't pull in the SDKs). */
export type AiProvider = "anthropic" | "openai";

/** Defaults; both are editable in Settings. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5.5",
};

/** Suggestions shown in Settings (any model id can be typed). */
export const MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  anthropic: [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
  ],
  openai: ["gpt-5.5", "gpt-5.5-pro", "gpt-6.1-sol", "gpt-5.4-mini"],
};

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
};
