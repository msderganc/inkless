/**
 * Hardware probe: runs the app's real B21SerialClient + PrinterSession against a physical printer
 * through Node's serialport (no browser). Skipped unless HW_PORT is set, e.g.
 *   HW_PORT=COM3 HW_SERIALPORT_DIR=<dir with node_modules/serialport> npx vitest run scripts/hw-probe.test.ts
 * Read-only: connects, identifies, reads RFID, heartbeats, disconnects. Never prints.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  B21SerialClient,
  type SerialPortLike,
} from "~/lib/printer/serial-client";
import { PrinterSession } from "~/lib/printer/session";

const PORT = process.env.HW_PORT;

interface NodeSerialPort {
  open(cb: (err: Error | null) => void): void;
  close(cb: (err: Error | null) => void): void;
  write(data: Uint8Array, cb: (err: Error | null | undefined) => void): void;
  on(ev: "data", cb: (d: Buffer) => void): void;
  on(ev: "close", cb: () => void): void;
  isOpen: boolean;
}

/** Adapts node-serialport to the Web Serial surface the app uses. */
class NodePortAdapter extends EventTarget implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly log: string[] = [];
  private port?: NodeSerialPort;

  constructor(
    private readonly ctor: new (o: object) => NodeSerialPort,
    private readonly path: string,
  ) {
    super();
  }

  async open() {
    const port = new this.ctor({
      path: this.path,
      baudRate: 115200,
      autoOpen: false,
    });
    await new Promise<void>((res, rej) =>
      port.open((e) => (e ? rej(e) : res())),
    );
    this.port = port;
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        port.on("data", (d) => {
          this.log.push(`<< ${d.toString("hex")}`);
          c.enqueue(new Uint8Array(d));
        });
        port.on("close", () => {
          try {
            c.close();
          } catch {
            // already closed
          }
        });
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) =>
        new Promise<void>((res, rej) => {
          this.log.push(`>> ${Buffer.from(chunk).toString("hex")}`);
          port.write(chunk, (e) => (e ? rej(e) : res()));
        }),
    });
  }

  async close() {
    const port = this.port;
    this.readable = null;
    this.writable = null;
    if (port?.isOpen) await new Promise<void>((res) => port.close(() => res()));
  }

  getInfo() {
    return { usbVendorId: 0x3513, usbProductId: 2 };
  }
}

describe.skipIf(!PORT)("hardware probe", () => {
  it("connects, identifies and disconnects through the app's session", async () => {
    const req = createRequire(`${process.env.HW_SERIALPORT_DIR}/`);
    const { SerialPort } = req("serialport") as {
      SerialPort: new (o: object) => NodeSerialPort;
    };
    const adapter = new NodePortAdapter(SerialPort, PORT!);
    const session = new PrinterSession({
      createClient: () => new B21SerialClient(async () => adapter),
    });
    try {
      await session.connect();
      const s = session.getStatus();
      process.stdout.write(
        `\nSTATUS ${JSON.stringify({ state: s.state, error: s.error, identity: s.identity, rfid: s.rfid })}\n`,
      );
      process.stdout.write(`PACKETS\n${adapter.log.join("\n")}\n`);
      expect(s.state).toBe("ready");
      await session.refreshRfid();
      const paper = await session.readPaperInfo();
      process.stdout.write(
        `RFID ${JSON.stringify(session.getStatus().rfid)}\nPAPER ${JSON.stringify(paper)}\n`,
      );
    } finally {
      await session.disconnect();
    }
  }, 60_000);

  // Prints one outline test label. Only with HW_PRINT=<label id>, e.g. HW_PRINT=round-31.
  it.skipIf(!process.env.HW_PRINT)(
    "prints one outline test label",
    async () => {
      const req = createRequire(`${process.env.HW_SERIALPORT_DIR}/`);
      const { SerialPort } = req("serialport") as {
        SerialPort: new (o: object) => NodeSerialPort;
      };
      const { findLabel } = await import("~/lib/catalogue");
      const { outlineTest } = await import("~/lib/render/outline-test");
      const { encodeForPrinter } = await import("~/lib/render/encode");
      const { nodeEnv } = await import("~/test/canvas-env");
      const { labelTypeFor } = await import("~/lib/printer/session");
      const spec = findLabel(process.env.HW_PRINT!)!;
      const adapter = new NodePortAdapter(SerialPort, PORT!);
      const session = new PrinterSession({
        createClient: () => new B21SerialClient(async () => adapter),
      });
      try {
        await session.connect();
        process.stdout.write(`
CONNECT ${JSON.stringify(session.getStatus().error ?? "ok")}
`);
        expect(session.getStatus().state).toBe("ready");
        adapter.log.length = 0;
        const out = await session.print({
          pageCount: 1,
          copies: 1,
          density: 3,
          labelType: labelTypeFor(spec.stock),
          renderPage: async () =>
            encodeForPrinter(
              outlineTest(spec, nodeEnv, Number(process.env.HW_OFFSET ?? 0))
                .print,
            ),
        });
        process.stdout.write(`\nOUTCOME ${JSON.stringify(out)}\n`);
        process.stdout.write(
          `PACKETS\n${adapter.log.filter((l) => !/^>> 5555(85|84|83)/.test(l)).join("\n")}\n` +
            `(image row packets: ${adapter.log.filter((l) => /^>> 5555(85|84|83)/.test(l)).length})\n`,
        );
      } finally {
        await session.disconnect();
      }
    },
    120_000,
  );
});
