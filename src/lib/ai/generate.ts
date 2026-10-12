import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { extractSvgs, sanitizeSvg } from "../svg";
import { type AiProvider } from "./models";
import { anthropicCost, type UsageEntry } from "./pricing";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  /** Test seam: replaces the network layer of both SDK clients. */
  fetch?: typeof fetch;
  /**
   * OpenAI only: `apiKey` is a "Sign in with ChatGPT" access token, billed to the ChatGPT plan.
   * That route requires streamed, unstored Responses requests with input as an array.
   */
  chatgptPlan?: boolean;
}

/** Text a model returned plus what it cost in tokens. */
interface Answer {
  text: string;
  /** Model that served the request (a fallback model if the requested one declined). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface GenerationResult {
  /** Sanitised SVGs (vector) or PNG data URLs (image models). */
  items: string[];
  usage: UsageEntry;
}

/** Claude models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

export const ICON_COUNT = 4;

/**
 * Instructions tuned for a 203 DPI direct-thermal printer: pure black on white, bold strokes,
 * no fine detail, no shading. Units are on a 100×100 canvas; at a 15 mm icon, 4 units ≈ 0.6 mm
 * ≈ 5 printer dots, the thinnest line that prints cleanly.
 */
export const ICON_SYSTEM_PROMPT = `You design icons for a small thermal label printer (203 DPI, pure black and white, no greys). Icons are printed about 10-25 mm wide.

Output exactly ${ICON_COUNT} different SVG icons for the user's request, each as a complete <svg>...</svg> block, and nothing else (no prose, no code fences).

Every SVG must follow these rules:
- viewBox="0 0 100 100", with about 6 units of empty margin on every side; centred.
- Only these elements: path, circle, ellipse, rect, line, polyline, polygon, g.
- Only black (#000) for fill or stroke; "none" for no fill. No white shapes, no other colours, no gradients, opacity, filters, masks, patterns, clip paths, images, text or <style>.
- Lines and outlines at least 4 units thick (stroke-width >= 4); gaps between shapes at least 3 units; no details smaller than 3 units.
- Bold, simple, instantly recognisable shapes: a strong silhouette or a thick outline. Avoid hatching, thin decorative lines and many small parts.
- No letters or words unless the request explicitly asks for them.

Make the ${ICON_COUNT} icons distinct: for example a solid silhouette, a thick outline, a rounded friendly version and a geometric version.`;

export class AiError extends Error {
  /** Set when the request was billed even though no usable icon came back. */
  usage?: UsageEntry;
  constructor(message: string, usage?: UsageEntry) {
    super(message);
    this.usage = usage;
  }
}

function anthropicError(e: unknown): AiError {
  if (e instanceof Anthropic.AuthenticationError)
    return new AiError("Anthropic rejected the API key. Check it in Settings.");
  if (e instanceof Anthropic.PermissionDeniedError)
    return new AiError("This Anthropic key can't use that model.");
  if (e instanceof Anthropic.NotFoundError)
    return new AiError(
      "Unknown Anthropic model. Check the model name in Settings.",
    );
  if (e instanceof Anthropic.RateLimitError)
    return new AiError("Anthropic rate limit reached. Try again in a minute.");
  if (e instanceof Anthropic.APIConnectionError)
    return new AiError("Couldn't reach Anthropic. Are you online?");
  if (e instanceof Anthropic.APIError)
    return new AiError(`Anthropic error ${e.status ?? ""}: ${e.message}`);
  return new AiError(e instanceof Error ? e.message : String(e));
}

function openaiError(e: unknown): AiError {
  if (e instanceof OpenAI.AuthenticationError)
    return new AiError("OpenAI rejected the API key. Check it in Settings.");
  if (e instanceof OpenAI.PermissionDeniedError)
    return new AiError("This OpenAI key can't use that model.");
  if (e instanceof OpenAI.NotFoundError)
    return new AiError(
      "Unknown OpenAI model. Check the model name in Settings.",
    );
  if (e instanceof OpenAI.RateLimitError)
    return new AiError("OpenAI rate limit reached. Try again in a minute.");
  if (e instanceof OpenAI.APIConnectionError) {
    const cause =
      e.cause instanceof Error ? ` (${e.cause.message})` : ` (${e.message})`;
    return new AiError(`Couldn't reach OpenAI. Are you online?${cause}`);
  }
  if (e instanceof OpenAI.APIError)
    return new AiError(`OpenAI error ${e.status ?? ""}: ${e.message}`);
  return new AiError(e instanceof Error ? e.message : String(e));
}

async function askAnthropic(
  cfg: AiConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<Answer> {
  // The user's own key, used only from this browser (local app, no server).
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  const useFallbacks = FALLBACK_MODELS.has(cfg.model);
  try {
    const response = await client.beta.messages.create(
      {
        model: cfg.model,
        max_tokens: 16000,
        system: ICON_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Icon request: ${prompt}` }],
        output_config: { effort: "medium" },
        // Server-side refusal fallback: a declined request is retried on a fallback model.
        ...(useFallbacks
          ? {
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default" as const,
            }
          : {}),
      },
      { signal },
    );
    const answer: Answer = {
      text: response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("\n"),
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    if (response.stop_reason === "refusal") {
      throw new AiError(
        "The model declined this request. Try describing the icon differently.",
        usageEntry(cfg, answer, prompt, "vector"),
      );
    }
    return answer;
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw anthropicError(e);
  }
}

async function askOpenAI(
  cfg: AiConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<Answer> {
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    // Plan tokens can't be used from a web page directly (CORS): go via the local server.
    ...(cfg.chatgptPlan && typeof location !== "undefined"
      ? { baseURL: `${location.origin}/openai/v1` }
      : {}),
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  try {
    const input = `Icon request: ${prompt}`;
    const response = cfg.chatgptPlan
      ? // ChatGPT plan route: stream: true, store: false, input as an array (OpenAI requirements).
        await client.responses
          .stream(
            {
              model: cfg.model,
              instructions: ICON_SYSTEM_PROMPT,
              input: [{ role: "user", content: input }],
              store: false,
            },
            { signal },
          )
          .finalResponse()
      : await client.responses.create(
          { model: cfg.model, instructions: ICON_SYSTEM_PROMPT, input },
          { signal },
        );
    return {
      text: response.output_text,
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (e) {
    if (cfg.chatgptPlan && e instanceof OpenAI.AuthenticationError)
      throw new AiError(
        "OpenAI rejected your ChatGPT sign-in. Sign out and sign in again in AI settings.",
      );
    if (
      cfg.chatgptPlan &&
      e instanceof Error &&
      e.message.includes("subscription_sharing_usage_limit_exceeded")
    )
      throw new AiError(
        "You've reached your ChatGPT plan's usage limit for apps. Try again later.",
      );
    throw openaiError(e);
  }
}

/** Raw model text → sanitised, de-duplicated monochrome SVGs (invalid ones are dropped). */
export function svgsFromModelText(text: string): string[] {
  const out: string[] = [];
  for (const raw of extractSvgs(text)) {
    try {
      const clean = sanitizeSvg(raw);
      if (!out.includes(clean)) out.push(clean);
    } catch {
      // Skip unusable variations; the others may still be fine.
    }
  }
  return out;
}

function usageEntry(
  cfg: AiConfig,
  a: Answer,
  prompt: string,
  kind: UsageEntry["kind"],
): UsageEntry {
  const plan = cfg.provider === "openai" && !!cfg.chatgptPlan;
  return {
    at: Date.now(),
    provider: cfg.provider,
    billing: plan ? "chatgpt-plan" : "api-key",
    model: a.model || cfg.model,
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
    costUsd:
      cfg.provider === "anthropic"
        ? anthropicCost(a.model || cfg.model, a.inputTokens, a.outputTokens)
        : undefined,
    prompt: prompt.slice(0, 120),
    kind,
  };
}

/** Generate up to ICON_COUNT print-ready icon variations for a text request. */
export async function generateIcons(
  cfg: AiConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const request = prompt.trim();
  if (!request) throw new AiError("Describe the icon first.");
  if (!cfg.apiKey.trim())
    throw new AiError("Add your API key in Settings first.");
  const answer =
    cfg.provider === "anthropic"
      ? await askAnthropic(cfg, request, signal)
      : await askOpenAI(cfg, request, signal);
  const usage = usageEntry(cfg, answer, request, "vector");
  const svgs = svgsFromModelText(answer.text);
  if (svgs.length === 0)
    throw new AiError(
      "The model didn't return a usable icon. Try again or rephrase.",
      usage,
    );
  return { items: svgs.slice(0, ICON_COUNT), usage };
}

/**
 * Prompt for OpenAI image models. The picture is converted to 1-bit afterwards, so it must
 * already be pure black ink on white with bold lines — any grey or fine detail would be lost.
 */
export const IMAGE_ICON_PROMPT = (request: string) =>
  `A single icon of: ${request}.
Style: bold black-and-white stamp or sticker icon for a 203 DPI thermal label printer.
Pure solid black ink on a pure white background. No grey, no shading, no gradients, no texture, no colour.
Thick, bold outlines and solid black fills; lines at least 1/25 of the image width; no fine detail or hatching.
Simple, instantly recognisable shapes, centred, with a wide white margin. No text, no frame, no shadow.`;

/** Max image bytes accepted from the API (base64 PNG), as a sanity bound. */
const MAX_IMAGE_B64 = 8_000_000;

/**
 * Generate ICON_COUNT pictures with an OpenAI image model; returns PNG data URLs. They are
 * added as image elements and thresholded to 1-bit by the renderer.
 */
export async function generateImageIcons(
  cfg: AiConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const request = prompt.trim();
  if (!request) throw new AiError("Describe the icon first.");
  if (!cfg.apiKey.trim())
    throw new AiError("Add your API key in Settings first.");
  if (cfg.chatgptPlan)
    throw new AiError(
      "Image models can't be used with a ChatGPT plan sign-in. Use the vector style or an API key.",
    );
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  try {
    const response = await client.images.generate(
      {
        model: cfg.model,
        prompt: IMAGE_ICON_PROMPT(request),
        n: ICON_COUNT,
        size: "1024x1024",
        quality: "medium",
        background: "opaque",
        output_format: "png",
      },
      { signal },
    );
    const urls = (response.data ?? [])
      .map((d) => d.b64_json)
      .filter(
        (b): b is string =>
          typeof b === "string" && b.length > 0 && b.length < MAX_IMAGE_B64,
      )
      .map((b) => `data:image/png;base64,${b}`);
    const usage = usageEntry(
      cfg,
      {
        text: "",
        model: cfg.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
      request,
      "image",
    );
    if (urls.length === 0)
      throw new AiError(
        "The image model didn't return a picture. Try again or rephrase.",
        usage,
      );
    return { items: urls, usage };
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw openaiError(e);
  }
}
