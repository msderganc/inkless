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
};

export default config;
