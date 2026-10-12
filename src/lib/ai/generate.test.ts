// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  AiError,
  generateIcons,
  ICON_SYSTEM_PROMPT,
  svgsFromModelText,
} from "./generate";

const SVG_A =
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#000"/></svg>';
const SVG_B =
  '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="none" stroke="#000" stroke-width="6"/></svg>';

interface Call {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeFetch(status: number, json: unknown, calls: Call[]): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return impl;
}

const anthropicMessage = (text: string, stop = "end_turn") => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

describe("svgsFromModelText", () => {
  it("extracts, sanitises and de-duplicates icons, dropping broken ones", () => {
    const out = svgsFromModelText(
      `${SVG_A}\n${SVG_A}\n<svg><script/></svg>\n${SVG_B}`,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("<circle");
    expect(out[1]).toContain('stroke-width="6"');
  });
});

describe("generateIcons — Anthropic", () => {
  it("calls the Messages API from the browser with the user's key, fallbacks and the thermal prompt", async () => {
    const calls: Call[] = [];
    const svgs = await generateIcons(
      {
        provider: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-opus-5-5",
        fetch: fakeFetch(200, anthropicMessage(`${SVG_A}\n${SVG_B}`), calls),
      },
      "a cat",
    );
    expect(svgs).toHaveLength(2);
    const call = calls[0]!;
    expect(call.url).toMatch(/\/v1\/messages/);
    expect(call.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(call.headers.get("anthropic-dangerous-direct-browser-access")).toBe(
      "true",
    );
    expect(call.headers.get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
    expect(call.body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      system: ICON_SYSTEM_PROMPT,
      output_config: { effort: "medium" },
    });
    expect(JSON.stringify(call.body.messages)).toContain("a cat");
  });

  it("omits fallbacks for models that don't support them", async () => {
    const calls: Call[] = [];
    await generateIcons(
      {
        provider: "anthropic",
        apiKey: "k",
        model: "claude-haiku-5-5",
        fetch: fakeFetch(200, anthropicMessage(SVG_A), calls),
      },
      "a cat",
    );
    expect(calls[0]!.body.fallbacks).toBeUndefined();
    expect(calls[0]!.headers.get("anthropic-beta") ?? "").not.toContain(
      "server-side-fallback",
    );
  });

  it("maps refusals, bad keys and empty output to clear errors", async () => {
    const run = (status: number, json: unknown) =>
      generateIcons(
        {
          provider: "anthropic",
          apiKey: "k",
          model: "claude-opus-5-5",
          fetch: fakeFetch(status, json, []),
        },
        "x",
      );
    await expect(run(200, anthropicMessage("", "refusal"))).rejects.toThrow(
      /declined/,
    );
    await expect(
      run(401, {
        type: "error",
        error: { type: "authentication_error", message: "bad" },
      }),
    ).rejects.toThrow(/rejected the API key/);
    await expect(run(200, anthropicMessage("no svg here"))).rejects.toThrow(
      /usable icon/,
    );
  });
});

describe("generateIcons — OpenAI", () => {
  it("calls the Responses API with the user's key and reads output_text", async () => {
    const calls: Call[] = [];
    const svgs = await generateIcons(
      {
        provider: "openai",
        apiKey: "sk-openai-test",
        model: "gpt-5.5",
        fetch: fakeFetch(
          200,
          {
            id: "resp_1",
            object: "response",
            created_at: 0,
            status: "completed",
            model: "gpt-5.5",
            output: [
              {
                type: "message",
                id: "m1",
                role: "assistant",
                status: "completed",
                content: [
                  { type: "output_text", text: SVG_B, annotations: [] },
                ],
              },
            ],
          },
          calls,
        ),
      },
      "a box",
    );
    expect(svgs).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/responses/);
    expect(calls[0]!.headers.get("authorization")).toBe(
      "Bearer sk-openai-test",
    );
    expect(calls[0]!.body).toMatchObject({
      model: "gpt-5.5",
      instructions: ICON_SYSTEM_PROMPT,
    });
  });

  it("maps a bad key to a clear error", async () => {
    await expect(
      generateIcons(
        {
          provider: "openai",
          apiKey: "k",
          model: "gpt-5.5",
          fetch: fakeFetch(
            401,
            { error: { message: "bad", type: "invalid_request_error" } },
            [],
          ),
        },
        "x",
      ),
    ).rejects.toThrow(/rejected the API key/);
  });
});

describe("generateIcons — input checks", () => {
  it("requires a prompt and a key, without any network call", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(200, {}, calls);
    await expect(
      generateIcons(
        { provider: "anthropic", apiKey: "k", model: "m", fetch: f },
        "  ",
      ),
    ).rejects.toThrow(AiError);
    await expect(
      generateIcons(
        { provider: "anthropic", apiKey: " ", model: "m", fetch: f },
        "cat",
      ),
    ).rejects.toThrow(/API key/);
    expect(calls).toHaveLength(0);
  });
});
