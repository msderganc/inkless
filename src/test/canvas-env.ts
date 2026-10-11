import { createCanvas, loadImage } from "@napi-rs/canvas";
import { type RenderEnv } from "~/lib/render/render";

/** Node rendering environment for tests (same 2D API as the browser). */
export const nodeEnv: RenderEnv = {
  createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderEnv["createCanvas"]>,
  loadImage: async (src) => loadImage(src),
};

/** A w×h PNG data URL: black left half, white right half. */
export function halfBlackPng(w: number, h: number): string {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, Math.floor(w / 2), h);
  return c.toDataURL("image/png");
}
