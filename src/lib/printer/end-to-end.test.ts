import { LabelType } from "@mmote/niimbluelib";
import { afterEach, describe, expect, it } from "vitest";
import { nodeEnv } from "~/test/canvas-env";
import { SimulatedB21S } from "~/test/simulated-printer";
import { findLabel } from "../catalogue";
import { emptyDesign, newText } from "../design";
import { encodeForPrinter } from "../render/encode";
import { renderLabel } from "../render/render";
import { B21SerialClient } from "./serial-client";
import { labelTypeFor, PrinterSession } from "./session";

let session: PrinterSession | undefined;
afterEach(async () => session?.disconnect());

function connectSimulated(port: SimulatedB21S) {
  session = new PrinterSession({
    createClient: () => {
      const c = new B21SerialClient(async () => port);
      c.setPacketInterval(0);
      return c;
    },
  });
  return session;
}

describe("end to end with the real D110 print task", () => {
  it("renders a batch, encodes it and prints it through NiimBlueLib", async () => {
    const port = new SimulatedB21S();
    const session = connectSimulated(port);
    await session.connect();
    expect(session.getStatus().state).toBe("ready");

    const spec = findLabel("rect-50x30")!;
    const design = {
      ...emptyDesign(spec.id),
      elements: [{ ...newText(2, 2, 46, 26), text: "BIN {n}" }],
    };
    const values = ["A1", "A2", "A3"];
    const out = await session.print({
      pageCount: values.length,
      copies: 2,
      density: 3,
      labelType: labelTypeFor(spec.stock),
      renderPage: async (i) =>
        encodeForPrinter(
          (
            await renderLabel(design, spec, nodeEnv, {
              record: { n: values[i]! },
            })
          ).print,
        ),
    });

    expect(out).toEqual({ status: "completed", printed: 3 });
    expect(port.density).toBe(3);
    expect(port.labelType).toBe(LabelType.WithGaps);
    expect(port.pagesPrinted).toBe(6);
    // B21S sequence: rows-only SetPageSize; the page is a full 384-dot head-width raster.
    expect(port.pageSizes).toEqual(Array(3).fill({ rows: 240 }));
    expect(port.imagePackets).toBeGreaterThan(0);
    expect(port.ended).toBe(1);
    expect(session.getStatus().state).toBe("ready");
  }, 30_000);

  it("surfaces a lid-open status from the printer and ends the job", async () => {
    const port = new SimulatedB21S();
    const session = connectSimulated(port);
    await session.connect();
    port.statusError = 1;
    const spec = findLabel("round-31")!;
    const out = await session.print({
      pageCount: 1,
      copies: 1,
      density: 3,
      labelType: labelTypeFor("clear"),
      renderPage: async () =>
        encodeForPrinter(
          (await renderLabel(emptyDesign(spec.id), spec, nodeEnv)).print,
        ),
    });
    expect(out).toMatchObject({
      status: "failed",
      error: "The printer lid is open.",
    });
    expect(port.labelType).toBe(LabelType.Transparent);
    expect(port.ended).toBe(1);
  }, 30_000);
});
