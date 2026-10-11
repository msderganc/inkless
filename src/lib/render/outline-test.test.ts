import { describe, expect, it } from "vitest";
import { nodeEnv } from "~/test/canvas-env";
import { CATALOGUE, findLabel } from "../catalogue";
import { DOTS_PER_MM, PRINTHEAD_DOTS } from "../geometry";
import { regionContains, safeRegion } from "../shapes";
import { encodeForPrinter } from "./encode";
import { blackCount } from "./mono";
import { outlineTest } from "./outline-test";

describe("outlineTest", () => {
  it.each(CATALOGUE.map((l) => [l.id, l] as const))(
    "%s: prints inside the safe area",
    (_, spec) => {
      const { label, print } = outlineTest(spec, nodeEnv);
      expect(blackCount(label)).toBeGreaterThan(0);
      expect(print.width).toBeLessThanOrEqual(PRINTHEAD_DOTS);
      const region = safeRegion(spec);
      for (let i = 0; i < label.data.length; i++) {
        if (!label.data[i]) continue;
        const x = ((i % label.width) + 0.5) / DOTS_PER_MM;
        const y = (Math.floor(i / label.width) + 0.5) / DOTS_PER_MM;
        expect(regionContains(region, x, y)).toBe(true);
      }
      expect(() => encodeForPrinter(print)).not.toThrow();
    },
  );

  it("round labels: the outline ring is centred", () => {
    const spec = findLabel("round-31")!;
    const { label } = outlineTest(spec, nodeEnv);
    const w = label.width;
    const row = Math.round((spec.heightMm / 2) * DOTS_PER_MM) + 5; // just off the crosshair
    const ink = [...label.data.subarray(row * w, (row + 1) * w)].flatMap(
      (v, x) => (v ? [x] : []),
    );
    const left = ink[0]!;
    const right = ink[ink.length - 1]!;
    expect(Math.abs(left + right + 1 - w)).toBeLessThanOrEqual(2);
  });
});
