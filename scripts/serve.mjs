// Serves the static build on http://localhost:5179 (fixed origin: storage is per origin, V8).
// Loopback only. Run it once to install the app; afterwards the service worker serves it offline
// and this server is not needed (V9). Ctrl+C to stop.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import handler from "serve-handler";

const PORT = 5179;
const HOST = "127.0.0.1";

if (!existsSync("out/index.html")) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(1);
}

const server = createServer((req, res) =>
  handler(req, res, {
    public: "out",
    // cleanUrls makes serve-handler resolve "/dir/" to "dir/index.html".
    cleanUrls: true,
    trailingSlash: true,
    directoryListing: false,
    headers: [
      { source: "sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "**/*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
    ],
  }),
);

server.listen(PORT, HOST, () => {
  console.log(`B21S Labels: http://localhost:${PORT}/`);
});
