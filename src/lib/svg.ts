import { MAX_SVG_CHARS } from "./design";

/** data: URL for an SVG string (UTF-8 safe), loadable as an image in browser and tests. */
export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** Elements allowed in icon SVG: plain monochrome geometry only. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);

/** Geometry and presentation attributes; everything else (scripts, events, links, styles) is dropped. */
const ALLOWED_ATTRS = new Set([
  "viewBox",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "width",
  "height",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "fill",
  "fill-rule",
  "clip-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "transform",
]);

const SAFE_VALUE = /^[\d\s.,+\-eEa-zA-Z#()%]*$/;

/** Map any paint to black, white or none so the icon is strictly two-tone. */
function monochrome(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === "none" || v === "transparent") return "none";
  if (v === "white" || v === "#fff" || v === "#ffffff") return "#fff";
  return "#000";
}

export class SvgError extends Error {}

/**
 * Sanitise untrusted SVG (AI output, pasted icons) into a strict monochrome subset:
 * allow-listed elements and attributes only, every paint forced to black/white/none, a viewBox
 * guaranteed, and a fixed intrinsic size so it rasterises predictably. Throws SvgError if the
 * input has no usable geometry. Requires a DOMParser (browser, or jsdom in tests).
 */
export function sanitizeSvg(
  input: string,
  parser: DOMParser = new DOMParser(),
): string {
  if (input.length > MAX_SVG_CHARS) throw new SvgError("The SVG is too large.");
  const doc = parser.parseFromString(input, "image/svg+xml");
  const root = doc.documentElement;
  if (
    root?.nodeName.toLowerCase() !== "svg" ||
    doc.getElementsByTagName("parsererror").length
  ) {
    throw new SvgError("Not a valid SVG image.");
  }

  const out = doc.implementation.createDocument(
    "http://www.w3.org/2000/svg",
    "svg",
    null,
  );
  const outRoot = out.documentElement;
  let shapes = 0;

  const copy = (src: Element, dst: Element) => {
    for (const child of Array.from(src.children)) {
      const name = child.localName;
      if (!ALLOWED_ELEMENTS.has(name) || name === "svg") continue;
      const el = out.createElementNS("http://www.w3.org/2000/svg", name);
      for (const attr of Array.from(child.attributes)) {
        if (!ALLOWED_ATTRS.has(attr.name) || !SAFE_VALUE.test(attr.value))
          continue;
        if (/url\s*\(/i.test(attr.value)) continue;
        const value =
          attr.name === "fill" || attr.name === "stroke"
            ? monochrome(attr.value)
            : attr.value;
        el.setAttribute(attr.name, value);
      }
      if (name !== "g") shapes++;
      dst.appendChild(el);
      copy(child, el);
    }
  };
  copy(root, outRoot);
  if (shapes === 0) throw new SvgError("The SVG has no shapes.");

  // Root presentation attributes (e.g. lucide's stroke settings) are kept; paints forced mono.
  for (const name of [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "fill-rule",
  ]) {
    const v = root.getAttribute(name);
    if (v !== null && SAFE_VALUE.test(v)) {
      outRoot.setAttribute(
        name,
        name === "fill" || name === "stroke" ? monochrome(v) : v,
      );
    }
  }
  const vb = root.getAttribute("viewBox");
  const w = parseFloat(root.getAttribute("width") ?? "");
  const h = parseFloat(root.getAttribute("height") ?? "");
  const viewBox =
    vb && SAFE_VALUE.test(vb) && vb.trim().split(/[\s,]+/).length === 4
      ? vb.trim()
      : w > 0 && h > 0
        ? `0 0 ${w} ${h}`
        : "0 0 100 100";
  outRoot.setAttribute("viewBox", viewBox);
  // Fixed intrinsic size: images need one to draw; the renderer scales to the element box.
  outRoot.setAttribute("width", "512");
  outRoot.setAttribute("height", "512");
  return new XMLSerializer().serializeToString(out);
}

/** Pull every <svg>…</svg> block out of model output text. */
export function extractSvgs(text: string): string[] {
  return [...text.matchAll(/<svg[\s\S]*?<\/svg>/gi)].map((m) => m[0]);
}
