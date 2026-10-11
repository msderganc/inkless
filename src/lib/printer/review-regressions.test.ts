/**
 * Regression tests for the printer-layer code review (connect/disconnect races, stale jobs,
 * stalled feeds, pending requests, stream end, port left open).
 */
import { type EncodedImage, LabelType, PacketGenerator } from "@mmote/niimbluelib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeEnv } from "~/test/canvas-env";
import { B21S_V40_28 } from "~/test/b21s-dump";
import { FakeSerialPort, parseDump } from "~/test/fake-serial-port";
import { SimulatedB21S } from "~/test/simulated-printer";
import { findLabel } from "../catalogue";
import { emptyDesign } from "../design";
import { encodeForPrinter } from "../render/encode";
import { renderLabel } from "../render/render";
import { B21SerialClient } from "./serial-client";
import { DEFAULT_DENSITY, type LockProvider, PrinterSession, type PrintJob, type SessionDeps } from "./session";

const table = parseDump(B21S_V40_28);
const sessions: PrinterSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.disconnect()));
});

function makeSession(ports: FakeSerialPort[], extra: Partial<SessionDeps> = {}) {
  let i = 0;
  const s = new PrinterSession({
    createClient: () => {
      const port = ports[Math.min(i++, ports.length - 1)]!;
      const c = new B21SerialClient(async () => port);
      c.setPacketInterval(0);
      return c;
    },
    ...extra,
  });
  sessions.push(s);
  return s;
}

const blankPage = async (): Promise<EncodedImage> => {
  const spec = findLabel("rect-40x30")!;
  return encodeForPrinter((await renderLabel(emptyDesign(spec.id), spec, nodeEnv)).print);
};
const job = (pageCount = 1): PrintJob => ({
  pageCount,
  copies: 1,
  density: DEFAULT_DENSITY,
  labelType: LabelType.WithGaps,
  renderPage: blankPage,
});

describe("connect/disconnect races", () => {
  it("disconnect while waiting for the lock wins, and the late lock is released", async () => {
    const port = new FakeSerialPort(table);
    let grant!: (release: () => void) => void;
    let released = 0;
    const lock: LockProvider = () => new Promise((r) => (grant = r));
    const s = makeSession([port], { lock });
    const connecting = s.connect();
    await vi.waitFor(() => expect(grant).toBeDefined());
    await s.disconnect();
    grant(() => released++);
    await connecting;
    expect(s.getStatus().state).toBe("disconnected");
    expect(port.opens).toBe(0);
    expect(released).toBe(1);
  });

  it("disconnect during negotiation leaves the port closed and the session disconnected", async () => {
    const port = new FakeSerialPort(table);
    const s = makeSession([port]);
    const connecting = s.connect();
    await vi.waitFor(() => expect(port.opens).toBe(1));
    await s.disconnect();
    await connecting;
    expect(s.getStatus().state).toBe("disconnected");
    expect(port.isOpen).toBe(false);
    expect(port.listeners.get("disconnect") ?? 0).toBe(0);
  });

  it("concurrent connect calls share one attempt", async () => {
    const port = new FakeSerialPort(table);
    const s = makeSession([port]);
    await Promise.all([s.connect(), s.connect(), s.connect()]);
    expect(port.opens).toBe(1);
    expect(s.getStatus().state).toBe("ready");
  });

  it("a silent printer ends in an error state with a message", async () => {
    const port = new FakeSerialPort(table);
    port.silent = true;
    const s = makeSession([port]);
    await s.connect();
    expect(s.getStatus().state).toBe("error");
    expect(s.getStatus().error).toMatch(/negotiate|respond/i);
    expect(port.isOpen).toBe(false);
  }, 20_000);

  it("a throwing lock provider ends in an error state instead of hanging in connecting", async () => {
    const s = makeSession([new FakeSerialPort(table)], {
      lock: async () => {
        throw new Error("locks unavailable");
      },
    });
    await s.connect();
    expect(s.getStatus()).toMatchObject({ state: "error", error: "locks unavailable" });
  });
});

describe("jobs and connection changes", () => {
  it("a stalled feed fails the label after the deadline, sends printEnd and returns to ready", async () => {
    const port = new SimulatedB21S();
    port.stalled = true;
    const s = makeSession([port], { pageDeadlineMs: () => 1_500 });
    await s.connect();
    const out = await s.print(job(3));
    expect(out).toMatchObject({ status: "failed", printed: 0 });
    expect(out.status === "failed" && out.error).toMatch(/did not finish the label in time/);
    expect(port.ended).toBe(1);
    expect(s.getStatus().state).toBe("ready");
  }, 20_000);

  it("disconnect while cancelling finishes promptly and the job is not resent", async () => {
    const port = new SimulatedB21S();
    port.stalled = true;
    const s = makeSession([port]);
    await s.connect();
    const running = s.print(job(2));
    await vi.waitFor(() => expect(port.pageSizes.length).toBe(1));
    void s.cancel();
    expect(s.getStatus().state).toBe("cancelling");
    const t0 = Date.now();
    await s.disconnect();
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(await running).toMatchObject({ status: "failed", printed: 0 });
    expect(port.pageSizes.length).toBe(1);
    expect(s.getStatus().state).toBe("disconnected");
  }, 20_000);

  it("a job interrupted by unplug does not overwrite a newer connection", async () => {
    const first = new SimulatedB21S();
    first.stalled = true;
    const second = new SimulatedB21S();
    const s = makeSession([first, second]);
    await s.connect();
    const running = s.print(job(2));
    await vi.waitFor(() => expect(first.pageSizes.length).toBe(1));
    first.unplug();
    await vi.waitFor(() => expect(s.getStatus().state).toBe("error"));
    await s.connect();
    expect(s.getStatus().state).toBe("ready");
    expect(await running).toMatchObject({ status: "failed" });
    await new Promise((r) => setTimeout(r, 50));
    expect(s.getStatus().state).toBe("ready");
    expect(s.getStatus().error).toBeUndefined();
    // The new connection can print.
    expect(await s.print(job(1))).toEqual({ status: "completed", printed: 1 });
  }, 20_000);

  it("cancel during a real job stops after the current label", async () => {
    const port = new SimulatedB21S();
    const s = makeSession([port]);
    await s.connect();
    let first = true;
    const out = await s.print({
      ...job(4),
      renderPage: async () => {
        if (!first) void s.cancel();
        first = false;
        return blankPage();
      },
    });
    expect(out).toEqual({ status: "cancelled", printed: 2 });
    expect(port.pagesPrinted).toBe(2);
    expect(port.ended).toBe(1);
  }, 20_000);
});

describe("B21SerialClient review fixes", () => {
  const connected = async (port: FakeSerialPort) => {
    const c = new B21SerialClient(async () => port);
    c.setHeartbeatAutoStart(false);
    c.setPacketInterval(0);
    await c.connect();
    return c;
  };

  it("rejects pending requests immediately on unplug instead of waiting for the timeout", async () => {
    const port = new FakeSerialPort(table);
    const c = await connected(port);
    port.silent = true;
    const pending = c.sendPacketWaitResponse(PacketGenerator.printStatus(), 10_000);
    await new Promise((r) => setTimeout(r, 20));
    const t0 = Date.now();
    port.unplug();
    await expect(pending).rejects.toThrow(/disconnected/);
    expect(Date.now() - t0).toBeLessThan(1_000);
    // The mutex is free again: a new request fails fast rather than queueing behind the old one.
    await expect(c.sendPacketWaitResponse(PacketGenerator.printStatus(), 10_000)).rejects.toThrow();
  });

  it("treats a stream that ends on its own as a disconnect", async () => {
    const port = new FakeSerialPort(table);
    const c = await connected(port);
    const gone = new Promise<void>((r) => c.once("disconnect", () => r()));
    port.endStream();
    await gone;
    expect(c.isConnected()).toBe(false);
    expect(port.isOpen).toBe(false);
  });

  it("recovers a port that was left open", async () => {
    const port = new FakeSerialPort(table);
    await port.open();
    const c = await connected(port);
    expect(c.isConnected()).toBe(true);
    await c.disconnect();
    expect(port.isOpen).toBe(false);
  });
});
