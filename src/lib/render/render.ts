import { type LabelSpec, SAFE_MARGIN_MM } from "../catalogue";
import { type BatchRecord, substitute } from "../batch";
import {
  type Design,
  type DesignElement,
  type IconElement,
  type ImageElement,
  type ShapeElement,
  type TextElement,
} from "../design";
import { svgToDataUrl } from "../svg";
import {
  DOTS_PER_MM,
  mmToDots,
  printWindow,
  PRINTHEAD_DOTS,
  type PrintWindow,
} from "../geometry";
import {
  type PathSink,
  regionContains,
  safeRegion,
  traceRegion,
} from "../shapes";
import {
  adjustThickness,
  dither,
  invert,
  luminance,
  type MonoBitmap,
  rotateBand180,
  positionOnHead,
  threshold,
  tileBand,
} from "./mono";

/** Minimal 2D context surface shared by browser canvases and @napi-rs/canvas (tests). */
export interface Ctx2D {
  fillStyle: unknown;
  font: string;
  textAlign: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(
    img: unknown,
    dx: number,
    dy: number,
    dw?: number,
    dh?: number,
  ): void;
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
  putImageData(data: unknown, x: number, y: number): void;
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): unknown;
}

export interface Drawable {
  width: number;
  height: number;
}

export interface RenderEnv {
  createCanvas(width: number, height: number): CanvasLike;
  loadImage(src: string): Promise<Drawable>;
}

export interface RenderOptions {
  /** This label's batch values ({n}, CSV columns); null/undefined for a single label. */
  record?: BatchRecord | null;
  /** Date used for {today}/{today+N} (default: now). */
  now?: Date;
  /** Horizontal calibration in dots: shifts the printed content (positive = right). */
  offsetDots?: number;
  /**
   * "print" (default): exactly what is sent to the printer.
   * "design": as the user designs it — jewelry panel 1 upright and no wrap repeat.
   */
  view?: "print" | "design";
}

export interface RenderResult {
  /** Full-label 1-bit raster (label width × feed length), already masked to the safe area. */
  label: MonoBitmap;
  /** The part sent to the printer (≤ 384 columns). */
  print: MonoBitmap;
  window: PrintWindow;
}

const ctxOf = (c: CanvasLike) => c.getContext("2d") as Ctx2D;

/** Box size in dots after accounting for element rotation (content is laid out in this box). */
function contentBox(el: DesignElement, s: number) {
  const sideways = el.rotation === 90 || el.rotation === 270;
  return { w: (sideways ? el.h : el.w) * s, h: (sideways ? el.w : el.h) * s };
}

function withElementTransform(
  ctx: Ctx2D,
  el: DesignElement,
  s: number,
  draw: (w: number, h: number) => void,
) {
  const box = contentBox(el, s);
  ctx.save();
  ctx.translate((el.x + el.w / 2) * s, (el.y + el.h / 2) * s);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-box.w / 2, -box.h / 2);
  draw(box.w, box.h);
  ctx.restore();
}

export const fontString = (el: TextElement, px: number) =>
  `${el.italic ? "italic " : ""}${el.bold ? "bold " : ""}${Math.max(1, Math.round(px))}px ${JSON.stringify(el.fontFamily)}, sans-serif`;

export const LINE_HEIGHT = 1.15;

/** Font size in px after auto-fit, for `lines` in a `w`×`h` px box. */
export function fitFontPx(
  ctx: Ctx2D,
  el: TextElement,
  lines: string[],
  w: number,
  h: number,
  s: number,
): number {
  let px = el.fontSizeMm * s;
  if (!el.autoFit) return px;
  ctx.font = fontString(el, px);
  const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const byWidth = (w / widest) * px;
  const byHeight = h / (lines.length * LINE_HEIGHT);
  px = Math.min(px, byWidth, byHeight);
  return Math.max(1, px);
}

/**
 * Curved text on the circle inscribed in the element box. "top" runs clockwise over the top
 * with letters upright from outside; "bottom" reads left to right along the bottom.
 */
function drawArcText(ctx: Ctx2D, el: TextElement, text: string, s: number) {
  const line = text.replace(/\r?\n/g, " ");
  withElementTransform(ctx, el, s, (w, h) => {
    const outer = Math.min(w, h) / 2;
    let px = el.fontSizeMm * s;
    ctx.font = fontString(el, px);
    // Baseline radius: glyphs sit just inside the box's circle.
    let r = outer - px * 0.6;
    const width = () => ctx.measureText(line).width;
    if (el.autoFit && r > 0) {
      // Keep the text within ~80% of the half circle.
      const maxArc = Math.PI * r * 0.8;
      if (width() > maxArc) {
        px = Math.max(1, (px * maxArc) / width());
        ctx.font = fontString(el, px);
        r = outer - px * 0.6;
      }
    }
    if (r <= 0) return;
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const total = width() / r;
    const top = el.arc === "top";
    let along = 0;
    for (const ch of [...line]) {
      const cw = ctx.measureText(ch).width;
      const mid = (along + cw / 2) / r;
      const a = top
        ? -Math.PI / 2 - total / 2 + mid
        : Math.PI / 2 + total / 2 - mid;
      ctx.save();
      ctx.translate(w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a));
      ctx.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      along += cw;
    }
  });
}

function drawText(
  ctx: Ctx2D,
  el: TextElement,
  record: BatchRecord | null,
  now: Date,
  s: number,
) {
  const text = substitute(el.text, record, now);
  if (el.arc !== "none") {
    drawArcText(ctx, el, text, s);
    return;
  }
  const lines = text.split(/\r?\n/);
  withElementTransform(ctx, el, s, (w, h) => {
    const px = fitFontPx(ctx, el, lines, w, h, s);
    ctx.font = fontString(el, px);
    ctx.fillStyle = "#000";
    ctx.textAlign = el.align;
    ctx.textBaseline = "middle";
    const lineH = px * LINE_HEIGHT;
    const top = h / 2 - (lines.length * lineH) / 2 + lineH / 2;
    const x = el.align === "left" ? 0 : el.align === "right" ? w : w / 2;
    lines.forEach((line, i) => {
      const y = top + i * lineH;
      ctx.fillText(line, x, y);
      if (el.underline && line.length > 0) {
        // Canvas has no underline; draw it under the glyphs, at least one printer dot thick.
        const width = ctx.measureText(line).width;
        const start =
          el.align === "left"
            ? x
            : el.align === "right"
              ? x - width
              : x - width / 2;
        const thickness = Math.max(s / 8, px * 0.07);
        ctx.fillRect(start, y + px * 0.42, width, thickness);
      }
    });
  });
}

async function drawImage(
  ctx: Ctx2D,
  el: ImageElement,
  env: RenderEnv,
  s: number,
  maxDots: number,
) {
  const img = await env.loadImage(el.src);
  if (!(img.width > 0 && img.height > 0)) return; // e.g. an SVG without intrinsic size
  const box = contentBox(el, s);
  // Anything beyond the label is masked anyway; never allocate more than a label-sized canvas.
  const bw = Math.max(1, Math.min(Math.round(box.w), maxDots));
  const bh = Math.max(1, Math.min(Math.round(box.h), maxDots));
  // Fit (contain) the image into the box, then convert to 1-bit at device resolution.
  const scale = Math.min(bw / img.width, bh / img.height);
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  const tmp = env.createCanvas(bw, bh);
  const t = ctxOf(tmp);
  t.imageSmoothingEnabled = true;
  t.fillStyle = "#fff";
  t.fillRect(0, 0, bw, bh);
  t.drawImage(
    img,
    Math.floor((bw - dw) / 2),
    Math.floor((bh - dh) / 2),
    dw,
    dh,
  );
  const gray = luminance(t.getImageData(0, 0, bw, bh).data, bw, bh);
  let mono = el.dither
    ? dither(gray, bw, bh)
    : threshold(gray, bw, bh, el.threshold);
  if (!el.dither && el.thickness) mono = adjustThickness(mono, el.thickness);
  if (el.invert) mono = invert(mono);
  const out = t.createImageData(bw, bh);
  for (let i = 0; i < mono.data.length; i++) {
    const p = i * 4;
    out.data[p] = out.data[p + 1] = out.data[p + 2] = 0;
    out.data[p + 3] = mono.data[i] ? 255 : 0;
  }
  const stamp = env.createCanvas(bw, bh);
  ctxOf(stamp).putImageData(out, 0, 0);
  withElementTransform(ctx, el, s, () => ctx.drawImage(stamp, 0, 0, bw, bh));
}

/** Shapes: rectangle, ellipse, line across the box, or a frame following the label outline. */
function drawShape(ctx: Ctx2D, el: ShapeElement, s: number, spec: LabelSpec) {
  const c = ctx as unknown as CanvasRenderingContext2D;
  // At least one printer dot thick so thin lines never vanish.
  const stroke = Math.max(s / DOTS_PER_MM, el.strokeMm * s);
  c.save();
  c.fillStyle = "#000";
  c.strokeStyle = "#000";
  c.lineWidth = stroke;
  if (el.shape === "frame") {
    // Follows the die-cut: drawn in label coordinates, ignoring the box.
    const rings = el.double ? [0, stroke * 2] : [0];
    for (const extra of rings) {
      const inset = SAFE_MARGIN_MM + (stroke / 2 + extra) / s;
      traceRegion(c, safeRegion(spec, inset), s);
      c.stroke();
    }
    c.restore();
    return;
  }
  c.restore();
  withElementTransform(ctx, el, s, (w, h) => {
    c.save();
    c.fillStyle = "#000";
    c.strokeStyle = "#000";
    c.lineWidth = stroke;
    c.beginPath();
    if (el.shape === "line") {
      c.fillRect(0, h / 2 - stroke / 2, w, stroke);
      c.restore();
      return;
    }
    // Inset by half the stroke so the outline stays inside the box.
    const i = el.fill ? 0 : stroke / 2;
    if (el.shape === "ellipse") {
      c.ellipse(
        w / 2,
        h / 2,
        Math.max(0, w / 2 - i),
        Math.max(0, h / 2 - i),
        0,
        0,
        Math.PI * 2,
      );
    } else {
      const rad = Math.max(
        0,
        Math.min(el.cornerMm * s, (w - 2 * i) / 2, (h - 2 * i) / 2),
      );
      c.roundRect(i, i, Math.max(0, w - 2 * i), Math.max(0, h - 2 * i), rad);
    }
    if (el.fill) c.fill();
    else c.stroke();
    c.restore();
  });
}

/** Icons are monochrome SVG: drawn at device size, then thresholded (never dithered). */
function iconAsImage(el: IconElement): ImageElement {
  return {
    id: el.id,
    kind: "image",
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    rotation: el.rotation,
    src: svgToDataUrl(el.svg),
    dither: false,
    threshold: 128,
    invert: el.invert,
    thickness: el.thickness,
  };
}

async function drawElements(
  ctx: Ctx2D,
  design: Design,
  spec: LabelSpec,
  env: RenderEnv,
  s: number,
  maxDots: number,
  record: BatchRecord | null,
  now: Date,
) {
  for (const el of design.elements) {
    if (el.hidden) continue;
    switch (el.kind) {
      case "text":
        drawText(ctx, el, record, now, s);
        break;
      case "image":
        await drawImage(ctx, el, env, s, maxDots);
        break;
      case "icon":
        await drawImage(ctx, iconAsImage(el), env, s, maxDots);
        break;
      case "shape":
        drawShape(ctx, el, s, spec);
        break;
    }
  }
}

/** Clear every pixel whose centre lies outside the label's safe area. */
export function maskToSafeArea(bmp: MonoBitmap, spec: LabelSpec): void {
  const region = safeRegion(spec);
  for (let y = 0; y < bmp.height; y++) {
    const ym = (y + 0.5) / DOTS_PER_MM;
    for (let x = 0; x < bmp.width; x++) {
      const i = y * bmp.width + x;
      if (bmp.data[i] && !regionContains(region, (x + 0.5) / DOTS_PER_MM, ym))
        bmp.data[i] = 0;
    }
  }
}

/** Shape-specific post-processing in device space (V5: x across head, y along feed). */
export function applyShapeTransforms(
  bmp: MonoBitmap,
  spec: LabelSpec,
  design: Design,
): void {
  if (spec.family === "jewelry" && spec.panels) {
    const p = spec.panels[1];
    rotateBand180(bmp, mmToDots(p.y), mmToDots(p.y + p.height) - mmToDots(p.y));
  }
  if (
    spec.family === "cable" &&
    spec.flag &&
    spec.wrap &&
    design.repeatInWrap
  ) {
    const f0 = mmToDots(spec.flag.y);
    const fh = mmToDots(spec.flag.y + spec.flag.height) - f0;
    const w0 = mmToDots(spec.wrap.y);
    const wh = mmToDots(spec.wrap.y + spec.wrap.height) - w0;
    // Mask first so only the flag's printable content is repeated, not stray marks in its margins.
    maskToSafeArea(bmp, spec);
    tileBand(bmp, f0, fh, w0, wh);
  }
  // Mask last: rotation and tiling are rounded to whole dots and must not push ink outside the die-cut.
  maskToSafeArea(bmp, spec);
}

/**
 * Smooth on-screen preview of the design (Design view): elements drawn at `pxPerMm` with
 * anti-aliasing, clipped to the printable area, on a transparent background. Images still show
 * their 1-bit conversion. Use renderLabel for what actually prints.
 */
export async function renderPreview(
  design: Design,
  spec: LabelSpec,
  env: RenderEnv,
  pxPerMm: number,
  opts: { record?: BatchRecord | null; now?: Date } = {},
): Promise<CanvasLike> {
  const width = Math.max(1, Math.round(spec.widthMm * pxPerMm));
  const height = Math.max(1, Math.round(spec.heightMm * pxPerMm));
  const canvas = env.createCanvas(width, height);
  // Browser and @napi-rs/canvas contexts both provide clip().
  const ctx = canvas.getContext("2d") as Ctx2D & { clip(): void };
  ctx.save();
  traceRegion(ctx as unknown as PathSink, safeRegion(spec), pxPerMm);
  ctx.clip();
  await drawElements(
    ctx,
    design,
    spec,
    env,
    pxPerMm,
    Math.max(width, height),
    opts.record ?? null,
    opts.now ?? new Date(),
  );
  ctx.restore();
  return canvas;
}

/** Render a design for one label (one batch value) to printer-ready 1-bit rasters. */
export async function renderLabel(
  design: Design,
  spec: LabelSpec,
  env: RenderEnv,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const s = DOTS_PER_MM;
  const window = printWindow(spec.widthMm);
  const width = window.labelDots;
  const height = mmToDots(spec.heightMm);
  const canvas = env.createCanvas(width, height);
  const ctx = ctxOf(canvas);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  await drawElements(
    ctx,
    design,
    spec,
    env,
    s,
    Math.max(width, height),
    opts.record ?? null,
    opts.now ?? new Date(),
  );

  const gray = luminance(
    ctx.getImageData(0, 0, width, height).data,
    width,
    height,
  );
  const label = threshold(gray, width, height, 128);
  if (opts.view === "design") maskToSafeArea(label, spec);
  else applyShapeTransforms(label, spec, design);
  const print = positionOnHead(label, PRINTHEAD_DOTS, opts.offsetDots ?? 0);
  return { label, print, window };
}
