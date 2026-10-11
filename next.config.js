/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Static export: the app runs entirely in the browser and is served from `out/` (no Node server).
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // H:\code has its own package.json; pin the project root so Next does not infer the parent.
  outputFileTracingRoot: import.meta.dirname,
};

export default config;
