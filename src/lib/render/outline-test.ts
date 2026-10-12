import { type LabelSpec } from "../catalogue";
import {
  DOTS_PER_MM,
  mmToDots,
  printWindow,
  PRINTHEAD_DOTS,
} from "../geometry";
import { safeRegion, traceRegion } from "../shapes";
import { positionOnHead, luminance, type MonoBitmap, threshold } from "./mono";
import { maskToSafeArea, type RenderEnv } from "./render";

/**
 * Shape-aware test print for any label: the printable-area outline, a centre crosshair with
 * 1 mm ticks, and the label size. On a correctly sized and aligned label the outline sits an even
 * ~1 mm inside the die-cut edge all round and the crosshair is centred.
 */
export function outlineTest(
  spec: LabelSpec,
  env: RenderEnv,
  offsetDots = 0,
): { label: MonoBitmap; print: MonoBitmap } {
  const s = DOTS_PER_MM;
  const win = printWindow(spec.widthMm);
  const width = win.labelDots;
  const height = mmToDots(spec.heightMm);
  const canvas = env.createCanvas(width, height);
  // Browser and @napi-rs/canvas contexts share this API.
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  // Outline drawn just inside the safe area so the mask keeps it whole.
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  traceRegion(ctx, safeRegion(spec, 1.2), s);
  ctx.stroke();

  // Crosshair through the label centre with a tick every mm.
  const cx = (spec.widthMm / 2) * s;
  const cy = (spec.heightMm / 2) * s;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, cy - 1, width, 2);
  ctx.fillRect(cx - 1, 0, 2, height);
  for (let mm = -Math.ceil(spec.widthMm / 2); mm <= spec.widthMm / 2; mm++) {
    const len = mm % 5 === 0 ? 1.5 : 0.8;
    ctx.fillRect(cx + mm * s, cy - len * s, 1, 2 * len * s);
  }
  for (let mm = -Math.ceil(spec.heightMm / 2); mm <= spec.heightMm / 2; mm++) {
    const len = mm % 5 === 0 ? 1.5 : 0.8;
    ctx.fillRect(cx - len * s, cy + mm * s, 2 * len * s, 1);
  }

  const px = Math.max(10, Math.min(spec.widthMm, spec.heightMm) * 0.09 * s);
  ctx.font = `bold ${Math.round(px)}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${spec.widthMm}×${spec.heightMm}`,
    cx + spec.widthMm * 0.2 * s,
    cy - spec.heightMm * 0.18 * s,
  );

  const label = threshold(
    luminance(ctx.getImageData(0, 0, width, height).data, width, height),
    width,
    height,
  );
  maskToSafeArea(label, spec);
  return {
    label,
    print: positionOnHead(label, PRINTHEAD_DOTS, offsetDots),
  };
}
