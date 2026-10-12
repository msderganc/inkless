// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractSvgs, sanitizeSvg, SvgError, svgToDataUrl } from "./svg";

describe("sanitizeSvg", () => {
  it("keeps geometry, forces paints to black/white/none, sets size and viewBox", () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 24 24" stroke="red"><path d="M1 1L5 5" fill="#3a3" stroke="blue" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="white"/></svg>',
    );
    expect(out).toContain('d="M1 1L5 5"');
    expect(out).toContain('fill="#000"');
    expect(out).toContain('stroke="#000"');
    expect(out).toContain('fill="#fff"');
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('width="512"');
    expect(out).not.toMatch(/red|blue|#3a3/);
  });

  it("strips scripts, event handlers, links, styles, images and foreign content", () => {
    const out = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
        <script>alert(1)</script>
        <style>*{fill:red}</style>
        <a href="javascript:alert(1)"><rect width="5" height="5"/></a>
        <image href="http://evil/x.png"/>
        <foreignObject><div>x</div></foreignObject>
        <rect width="10" height="10" fill="url(#g)" onclick="x()" style="fill:red"/>
      </svg>`,
    );
    expect(out).not.toMatch(
      /script|onload|onclick|style|href|image|foreignObject|url\(/i,
    );
    expect(out).toContain("<rect");
  });

  it("derives a viewBox from width/height and rejects non-SVG or empty input", () => {
    expect(
      sanitizeSvg(
        '<svg width="40" height="20"><rect width="4" height="4"/></svg>',
      ),
    ).toContain('viewBox="0 0 40 20"');
    expect(() => sanitizeSvg("<html><body/></html>")).toThrow(SvgError);
    expect(() => sanitizeSvg("<svg></svg>")).toThrow(SvgError);
    expect(() => sanitizeSvg("not xml")).toThrow(SvgError);
  });
});

describe("svg helpers", () => {
  it("extracts SVG blocks from model text", () => {
    const text =
      'Here:\n```svg\n<svg a="1"><path d="M0 0"/></svg>\n```\nand <SVG b="2"></SVG>';
    expect(extractSvgs(text)).toEqual([
      '<svg a="1"><path d="M0 0"/></svg>',
      '<SVG b="2"></SVG>',
    ]);
  });

  it("encodes UTF-8 into a data URL", () => {
    expect(svgToDataUrl("<svg>é</svg>")).toBe(
      `data:image/svg+xml;base64,${Buffer.from("<svg>é</svg>").toString("base64")}`,
    );
  });
});
