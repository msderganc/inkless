// The local server's ChatGPT relay must survive every way a request can fail (review P1).
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const haveBuild = existsSync(`${ROOT}/out/index.html`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let upstream: Server;
let server: ChildProcess;
let port = 0;
let output = "";

/** Fake OpenAI: "/v1/responses" streams a little then drops; "/v1/models" answers. */
function startUpstream(): Promise<number> {
  upstream = createServer((req, res) => {
    req.resume();
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"data":[]}');
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
    // Keep streaming slowly, then cut the connection (an upstream failure).
    const t = setInterval(() => res.write("data: more\n\n"), 50);
    setTimeout(() => {
      clearInterval(t);
      res.socket?.destroy();
    }, 400);
    res.on("close", () => clearInterval(t));
  });
  return new Promise((r) =>
    upstream.listen(0, "127.0.0.1", () =>
      r((upstream.address() as AddressInfo).port),
    ),
  );
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const p = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return p;
}

function alive(): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: "/openai/v1/models", method: "GET" },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe.skipIf(!haveBuild)("local server OpenAI relay", () => {
  beforeAll(async () => {
    const up = await startUpstream();
    port = await freePort();
    server = spawn(process.execPath, ["scripts/serve.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        LABEL_PORT: String(port),
        LABEL_OAUTH_PORT: String(await freePort()),
        LABEL_OPENAI_UPSTREAM: `http://127.0.0.1:${up}/v1`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (d) => (output += String(d)));
    server.stderr?.on("data", (d) => (output += String(d)));
    for (let i = 0; i < 50 && !output.includes("http://"); i++)
      await sleep(100);
  }, 15_000);

  afterAll(() => {
    server?.kill();
    upstream?.close();
  });

  it("survives the upstream dropping mid-stream", async () => {
    await new Promise<void>((resolve) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/openai/v1/responses",
          method: "POST",
        },
        (res) => {
          res.on("data", () => undefined);
          res.on("close", () => resolve());
          res.on("error", () => resolve());
        },
      );
      req.on("error", () => resolve());
      req.end("{}");
    });
    await sleep(200);
    expect(server.exitCode).toBeNull();
    expect(await alive()).toBe(200);
  });

  it("survives the app cancelling the response mid-stream", async () => {
    await new Promise<void>((resolve) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/openai/v1/responses",
          method: "POST",
        },
        (res) => {
          res.once("data", () => {
            req.destroy(); // like closing the AI dialog while it streams
            resolve();
          });
        },
      );
      req.on("error", () => undefined);
      req.end("{}");
    });
    await sleep(600);
    expect(server.exitCode).toBeNull();
    expect(await alive()).toBe(200);
  });

  it("survives an upload cut off part-way", async () => {
    const sock = connect(port, "127.0.0.1");
    await new Promise<void>((r) => sock.on("connect", () => r()));
    sock.write(
      'POST /openai/v1/responses HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"partial":',
    );
    await sleep(100);
    sock.destroy();
    await sleep(300);
    expect(server.exitCode).toBeNull();
    expect(await alive()).toBe(200);
    expect(output).not.toMatch(/Unhandled|ERR_|Error:/);
  });
});
