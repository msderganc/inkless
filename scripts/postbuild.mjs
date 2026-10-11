// Writes the precache list and build id into out/sw.js, and records bundle hashes
// (spec Phase 7.1: record versions and hashes of the packaged app).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OUT = "out";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(OUT)
  .map((p) => relative(OUT, p).split(sep).join("/"))
  .filter((f) => f !== "sw.js" && f !== "build-manifest.json")
  .sort();

const hashes = Object.fromEntries(
  files.map((f) => [
    f,
    createHash("sha256")
      .update(readFileSync(join(OUT, f)))
      .digest("hex"),
  ]),
);
const buildId = createHash("sha256")
  .update(JSON.stringify(hashes))
  .digest("hex")
  .slice(0, 16);

// Precache URLs: "dir/index.html" is served at "/dir/".
const urls = files.map((f) =>
  f === "index.html"
    ? "/"
    : f.endsWith("/index.html")
      ? `/${f.slice(0, -10)}`
      : `/${f}`,
);

const swPath = join(OUT, "sw.js");
const sw = readFileSync(swPath, "utf8")
  .replace(`"__BUILD_ID__"`, JSON.stringify(buildId))
  .replace("= __PRECACHE__;", `= ${JSON.stringify(urls)};`);
if (sw.includes("__PRECACHE__") || sw.includes("__BUILD_ID__"))
  throw new Error("sw.js placeholders not replaced");
writeFileSync(swPath, sw);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(
  join(OUT, "build-manifest.json"),
  JSON.stringify(
    {
      app: pkg.name,
      version: pkg.version,
      buildId,
      builtAt: new Date().toISOString(),
      files: hashes,
    },
    null,
    2,
  ),
);
console.log(`postbuild: ${urls.length} files precached, build ${buildId}`);
