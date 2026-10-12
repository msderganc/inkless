import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { extractSvgs, sanitizeSvg } from "../svg";
import { type AiProvider } from "./models";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  /** Test seam: replaces the network layer of both SDK clients. */
  fetch?: typeof fetch;
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

export class AiError extends Error {}

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
  if (e instanceof OpenAI.APIConnectionError)
    return new AiError("Couldn't reach OpenAI. Are you online?");
  if (e instanceof OpenAI.APIError)
    return new AiError(`OpenAI error ${e.status ?? ""}: ${e.message}`);
  return new AiError(e instanceof Error ? e.message : String(e));
}

async function askAnthropic(
  cfg: AiConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
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
    if (response.stop_reason === "refusal") {
      throw new AiError(
        "The model declined this request. Try describing the icon differently.",
      );
    }
    return response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw anthropicError(e);
  }
}

async function askOpenAI(
  cfg: AiConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  try {
    const response = await client.responses.create(
      {
        model: cfg.model,
        instructions: ICON_SYSTEM_PROMPT,
        input: `Icon request: ${prompt}`,
      },
      { signal },
    );
    return response.output_text;
  } catch (e) {
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

/** Generate up to ICON_COUNT print-ready icon variations for a text request. */
export async function generateIcons(
  cfg: AiConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const request = prompt.trim();
  if (!request) throw new AiError("Describe the icon first.");
  if (!cfg.apiKey.trim())
    throw new AiError("Add your API key in Settings first.");
  const text =
    cfg.provider === "anthropic"
      ? await askAnthropic(cfg, request, signal)
      : await askOpenAI(cfg, request, signal);
  const svgs = svgsFromModelText(text);
  if (svgs.length === 0)
    throw new AiError(
      "The model didn't return a usable icon. Try again or rephrase.",
    );
  return svgs.slice(0, ICON_COUNT);
}
