// Serves the static build on http://localhost:5179 (fixed origin: storage is per origin, V8).
// Loopback only. Run it once to install the app; afterwards the service worker serves it offline
// and this server is not needed (V9), except for "Sign in with ChatGPT" (below). Ctrl+C to stop.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import handler from "serve-handler";

const PORT = 5179;
// Both loopback addresses: browsers may resolve "localhost" to IPv6 (::1) first.
const HOSTS = ["127.0.0.1", "::1"];

if (!existsSync("out/index.html")) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(1);
}

// "Sign in with ChatGPT" requests: OpenAI doesn't allow these from a web page (CORS), so the
// app sends them here and this forwards them, unchanged, to api.openai.com. Only the
// Responses and Models endpoints, only from the app's own pages, nothing logged or stored.
const PROXY_PREFIX = "/openai/v1/";
const PROXY_PATHS = new Set(["responses", "models"]);
const APP_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `http://[::1]:${PORT}`,
]);
const MAX_BODY = 1_000_000;

async function proxyOpenAI(req, res) {
  const path = req.url.slice(PROXY_PREFIX.length).split("?")[0];
  const origin = req.headers.origin;
  if (!PROXY_PATHS.has(path) || (origin && !APP_ORIGINS.has(origin))) {
    res.writeHead(403).end();
    return;
  }
  if (req.method !== "POST" && req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(c);
  }
  const headers = {};
  for (const h of ["authorization", "content-type", "accept"]) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  const ctl = new AbortController();
  res.on("close", () => ctl.abort());
  try {
    const upstream = await fetch(`https://api.openai.com/v1/${path}`, {
      method: req.method,
      headers,
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      signal: ctl.signal,
    });
    const out = { "Cache-Control": "no-store" };
    for (const h of ["content-type", "x-request-id"]) {
      const v = upstream.headers.get(h);
      if (v) out[h] = v;
    }
    res.writeHead(upstream.status, out);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (e) {
    if (ctl.signal.aborted) return;
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: `The local server couldn't reach OpenAI: ${e.cause?.code ?? e.message}`,
          type: "proxy_error",
        },
      }),
    );
  }
}

const app = (req, res) => {
  if (req.url?.startsWith(PROXY_PREFIX)) {
    void proxyOpenAI(req, res);
    return;
  }
  return handler(req, res, {
    public: "out",
    // cleanUrls makes serve-handler resolve "/dir/" to "dir/index.html".
    cleanUrls: true,
    trailingSlash: true,
    directoryListing: false,
    headers: [
      {
        source: "sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        source: "**/*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ],
  });
};

let listening = 0;
for (const host of HOSTS) {
  const server = createServer(app);
  server.on("error", (e) => {
    // ::1 is unavailable when IPv6 is disabled; IPv4 alone still works.
    if (host === "::1")
      console.warn(
        `IPv6 loopback unavailable (${e.code}); serving on 127.0.0.1 only.`,
      );
    else {
      console.error(e.message);
      process.exit(1);
    }
  });
  server.listen(PORT, host, () => {
    if (++listening === 1)
      console.log(`B21S Labels: http://localhost:${PORT}/`);
  });
}

// "Sign in with ChatGPT" requires a loopback redirect on 127.0.0.1 (never "localhost").
// This listener only forwards OpenAI's redirect (code + state) to the app, which does the
// PKCE token exchange itself. It sees the one-time authorization code, nothing else.
const OAUTH_PORT = 1455;
const APP_ORIGIN = `http://localhost:${PORT}`;
const oauth = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${OAUTH_PORT}`);
  if (url.pathname === "/health") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": APP_ORIGIN,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain",
    });
    res.end("ok");
    return;
  }
  if (url.pathname === "/auth/callback") {
    const forward = new URLSearchParams();
    for (const k of [
      "code",
      "state",
      "client_id",
      "error",
      "error_description",
    ]) {
      const v = url.searchParams.get(k);
      if (v) forward.set(k, v);
    }
    res.writeHead(302, {
      Location: `${APP_ORIGIN}/oauth-callback/?${forward.toString()}`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    res.end();
    return;
  }
  res.writeHead(404);
  res.end();
});
oauth.on("error", (e) =>
  console.warn(
    `ChatGPT sign-in listener unavailable on 127.0.0.1:${OAUTH_PORT} (${e.code}).`,
  ),
);
oauth.listen(OAUTH_PORT, "127.0.0.1");
