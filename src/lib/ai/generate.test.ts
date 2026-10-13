// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  AiError,
  categoriesFromModelText,
  generateIcons,
  generateImageIcons,
  generatePattern,
  ICON_SYSTEM_PROMPT,
  PATTERN_SYSTEM_PROMPT,
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

describe("categoriesFromModelText", () => {
  it("keeps known categories from the first line, normalised, at most 3", () => {
    expect(
      categoriesFromModelText(
        "Categories: Animals, Food & Beverage, made-up, nature, home\n<svg/>",
      ),
    ).toEqual(["animals", "food-beverage", "nature"]);
    expect(categoriesFromModelText("<svg></svg>")).toEqual([]);
  });

  it("asks the model for categories from the library list", () => {
    expect(ICON_SYSTEM_PROMPT).toContain("Categories:");
    expect(ICON_SYSTEM_PROMPT).toContain("food-beverage");
  });
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
    const result = await generateIcons(
      {
        provider: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-opus-5-5",
        fetch: fakeFetch(200, anthropicMessage(`${SVG_A}\n${SVG_B}`), calls),
      },
      "a cat",
    );
    expect(result.items).toHaveLength(2);
    expect(result.categories).toEqual([]);
    expect(result.usage).toMatchObject({
      provider: "anthropic",
      billing: "api-key",
      model: "claude-opus-5-5",
      inputTokens: 10,
      outputTokens: 10,
      kind: "vector",
      prompt: "a cat",
    });
    // 10 in × $4/MTok + 10 out × $20/MTok
    expect(result.usage.costUsd).toBeCloseTo(0.00024, 8);
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
    // A refusal is still billed, so the error carries its usage.
    const refused = await run(200, anthropicMessage("", "refusal")).catch(
      (e: unknown) => e,
    );
    expect(refused).toBeInstanceOf(AiError);
    expect((refused as AiError).usage).toMatchObject({ inputTokens: 10 });
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
    const result = await generateIcons(
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
            usage: {
              input_tokens: 7,
              output_tokens: 9,
              total_tokens: 16,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
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
    expect(result.items).toHaveLength(1);
    expect(result.usage).toMatchObject({
      provider: "openai",
      billing: "api-key",
      inputTokens: 7,
      outputTokens: 9,
      costUsd: undefined,
    });
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

describe("generateImageIcons — OpenAI image models", () => {
  it("calls the Images API asking for opaque PNGs and returns data URLs", async () => {
    const calls: Call[] = [];
    const { items: urls, usage } = await generateImageIcons(
      {
        provider: "openai",
        apiKey: "sk-openai-test",
        model: "gpt-image-2",
        fetch: fakeFetch(
          200,
          {
            created: 0,
            data: [{ b64_json: "iVBORw0KGgo=" }, { b64_json: "AAAA" }],
          },
          calls,
        ),
      },
      "a cat",
    );
    expect(urls).toEqual([
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/png;base64,AAAA",
    ]);
    expect(usage).toMatchObject({
      provider: "openai",
      kind: "image",
      billing: "api-key",
    });
    expect(calls[0]!.url).toMatch(/\/images\/generations/);
    expect(calls[0]!.body).toMatchObject({
      model: "gpt-image-2",
      n: 4,
      background: "opaque",
      output_format: "png",
    });
    expect(String(calls[0]!.body.prompt)).toContain("a cat");
    expect(String(calls[0]!.body.prompt)).toMatch(/black ink on a pure white/);
  });

  it("errors clearly when no picture comes back or the key is wrong", async () => {
    await expect(
      generateImageIcons(
        {
          provider: "openai",
          apiKey: "k",
          model: "gpt-image-2",
          fetch: fakeFetch(200, { created: 0, data: [] }, []),
        },
        "x",
      ),
    ).rejects.toThrow(/didn't return a picture/);
    await expect(
      generateImageIcons(
        {
          provider: "openai",
          apiKey: "k",
          model: "gpt-image-2",
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

function sseFetch(events: unknown[], calls: Call[]): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as Record<string, unknown>,
    });
    const text = events
      .map(
        (e) =>
          `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`,
      )
      .join("");
    return new Response(text, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
}

describe("generateIcons — ChatGPT plan sign-in", () => {
  it("streams an unstored Responses request with the access token and records plan billing", async () => {
    const calls: Call[] = [];
    const response = (status: string, output: unknown[]) => ({
      id: "resp_1",
      object: "response",
      created_at: 0,
      status,
      model: "gpt-6.1-sol",
      output,
      usage: {
        input_tokens: 5,
        output_tokens: 6,
        total_tokens: 11,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
    const message = {
      type: "message",
      id: "m1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: SVG_A, annotations: [] }],
    };
    const result = await generateIcons(
      {
        provider: "openai",
        apiKey: "chatgpt-access-token",
        model: "gpt-6.1-sol",
        chatgptPlan: true,
        fetch: sseFetch(
          [
            {
              type: "response.created",
              sequence_number: 0,
              response: response("in_progress", []),
            },
            {
              type: "response.completed",
              sequence_number: 1,
              response: response("completed", [message]),
            },
          ],
          calls,
        ),
      },
      "a cat",
    );
    expect(result.items).toHaveLength(1);
    expect(result.usage).toMatchObject({
      billing: "chatgpt-plan",
      costUsd: undefined,
      model: "gpt-6.1-sol",
    });
    expect(calls[0]!.headers.get("authorization")).toBe(
      "Bearer chatgpt-access-token",
    );
    expect(calls[0]!.body).toMatchObject({ stream: true, store: false });
    expect(Array.isArray(calls[0]!.body.input)).toBe(true);
  });

  it("uses the streamed text when the final event omits the output", async () => {
    const base = {
      id: "resp_2",
      object: "response",
      created_at: 0,
      model: "gpt-6.1-sol",
      output: [],
    };
    const result = await generateIcons(
      {
        provider: "openai",
        apiKey: "t",
        model: "gpt-6.1-sol",
        chatgptPlan: true,
        fetch: sseFetch(
          [
            {
              type: "response.created",
              sequence_number: 0,
              response: { ...base, status: "in_progress" },
            },
            {
              type: "response.output_item.added",
              sequence_number: 1,
              output_index: 0,
              item: {
                type: "message",
                id: "m1",
                role: "assistant",
                status: "in_progress",
                content: [],
              },
            },
            {
              type: "response.content_part.added",
              sequence_number: 1,
              item_id: "m1",
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            },
            {
              type: "response.output_text.delta",
              sequence_number: 1,
              item_id: "m1",
              output_index: 0,
              content_index: 0,
              delta: SVG_A.slice(0, 20),
              logprobs: [],
            },
            {
              type: "response.output_text.delta",
              sequence_number: 2,
              item_id: "m1",
              output_index: 0,
              content_index: 0,
              delta: SVG_A.slice(20),
              logprobs: [],
            },
            {
              type: "response.completed",
              sequence_number: 3,
              response: { ...base, status: "completed" },
            },
          ],
          [],
        ),
      },
      "a cat",
    );
    expect(result.items).toHaveLength(1);
  });

  it("includes the model's text when it has no usable icon", async () => {
    const err = await generateIcons(
      {
        provider: "anthropic",
        apiKey: "k",
        model: "claude-opus-5-5",
        fetch: fakeFetch(200, anthropicMessage("Sorry, here is a cat: 🐱"), []),
      },
      "a cat",
    ).catch((e: unknown) => e);
    expect((err as AiError).modelText).toContain("here is a cat");
  });

  it("refuses image models on a plan sign-in", async () => {
    await expect(
      generateImageIcons(
        {
          provider: "openai",
          apiKey: "t",
          model: "gpt-image-2",
          chatgptPlan: true,
        },
        "x",
      ),
    ).rejects.toThrow(/ChatGPT plan/);
  });
});

describe("generatePattern", () => {
  const cfg = (fetchImpl: typeof fetch) => ({
    provider: "anthropic" as const,
    apiKey: "k",
    model: "claude-opus-5-5",
    fetch: fetchImpl,
  });
  /** Replies in turn with each text. */
  const replies = (texts: string[], calls: Call[]): typeof fetch => {
    let k = 0;
    return (input, init) =>
      fakeFetch(
        200,
        anthropicMessage(texts[Math.min(k++, texts.length - 1)]!),
        calls,
      )(input, init);
  };
  const check = (t: string) => (t.includes("{bad}") ? "bad group" : undefined);

  it("returns the label text, asking with the syntax guide", async () => {
    const calls: Call[] = [];
    const out = await generatePattern(
      cfg(replies(['{"text": "{1/4-2:1/4}\\"", "note": "8 labels"}'], calls)),
      "every quarter inch to 2",
      check,
    );
    expect(out).toMatchObject({ text: '{1/4-2:1/4}"', note: "8 labels" });
    expect(out.usage).toMatchObject({
      kind: "text",
      prompt: "every quarter inch to 2",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.system).toBe(PATTERN_SYSTEM_PROMPT);
  });

  it("repairs once using the app's error, summing the tokens", async () => {
    const calls: Call[] = [];
    const out = await generatePattern(
      cfg(replies(['{"text": "{bad}"}', '{"text": "{1-5}"}'], calls)),
      "1 to 5",
      check,
    );
    expect(out.text).toBe("{1-5}");
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.body.messages)).toContain("bad group");
    expect(out.usage.inputTokens).toBe(20);
  });

  it("gives up after the repair, still reporting usage", async () => {
    const err = await generatePattern(
      cfg(replies(["no json here", "still none"], [])),
      "x",
      check,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).usage).toMatchObject({ kind: "text" });
    expect((err as AiError).message).toMatch(/Couldn't turn that/);
  });
});
