/** Provider and model choices (kept separate from generate.ts so it doesn't pull in the SDKs). */
export type AiProvider = "anthropic" | "openai";

/**
 * How icons are made:
 * - "vector": a text model writes SVG (crisp, bold, ideal for thermal printing; both providers).
 * - "image": an image model draws a picture, converted to black and white (OpenAI only).
 */
export type IconStyle = "vector" | "image";

/** Defaults; all are editable in Settings. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-6.1-sol",
};
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2";

/** Models offered in Settings; the first is the recommended default (a custom id can also be entered). */
export const MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  anthropic: [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
    "claude-opus-5",
  ],
  openai: [
    "gpt-6.1-sol",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4-mini",
  ],
};

export const OPENAI_IMAGE_MODELS = [
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2",
  "gpt-image-1.5",
  "chatgpt-image-latest",
];

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
};
