// Serves the static build on http://localhost:5179 (fixed origin: storage is per origin, V8).
// Loopback only. Run it once to install the app; afterwards the service worker serves it offline
// and this server is not needed (V9). Ctrl+C to stop.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import handler from "serve-handler";

const PORT = 5179;
// Both loopback addresses: browsers may resolve "localhost" to IPv6 (::1) first.
const HOSTS = ["127.0.0.1", "::1"];

if (!existsSync("out/index.html")) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(1);
}

const app = (req, res) =>
  handler(req, res, {
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
