import { type AbstractPrintTask, type EncodedImage, LabelType, PrintError, PrinterErrorCode } from "@mmote/niimbluelib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { B21S_V40_28 } from "~/test/b21s-dump";
import { FakeSerialPort, parseDump } from "~/test/fake-serial-port";
import { B21SerialClient } from "./serial-client";
import {
  ACTIVE_WINDOW_MS,
  DEFAULT_DENSITY,
  HEARTBEAT_ACTIVE_MS,
  HEARTBEAT_IDLE_MS,
  type JobOutcome,
  labelTypeFor,
  PrinterSession,
  type PrintJob,
  type SessionDeps,
} from "./session";

const B21S = parseDump(B21S_V40_28);
/** Same dump but the printer reports model id 257 instead of 777. */
const OTHER_MODEL = parseDump(
  B21S_V40_28.replace("<< 55554802030940aaaa", "<< 5555480201014aaaaa"),
);

class Deferred {
  resolve!: () => void;
  readonly promise = new Promise<void>((r) => (this.resolve = r));
}

/** Records print-task calls; pages finish when the test says so (or immediately). */
class FakeTask {
  calls: string[] = [];
  pageGates: Deferred[] = [];
  failOnPage?: number;
  autoFinish = true;
  private page = 0;

  async printInit() {
    this.calls.push("init");
  }
  async printPage(_img: EncodedImage, qty?: number) {
    this.page++;
    this.calls.push(`page${this.page}x${qty}`);
    if (this.failOnPage === this.page) throw new PrintError("Print error 1: CoverOpen", PrinterErrorCode.CoverOpen);
  }
  async waitForPageFinished() {
    if (this.autoFinish) return;
    const gate = new Deferred();
    this.pageGates.push(gate);
    await gate.promise;
  }
  async printEnd() {
    this.calls.push("end");
    return true;
  }
}

const image: EncodedImage = { cols: 8, rows: 1, rowsData: [], pageColor: 0 };

function job(pageCount: number, copies = 1): PrintJob {
  return { pageCount, copies, density: DEFAULT_DENSITY, labelType: LabelType.WithGaps, renderPage: async () => image };
}

let session: PrinterSession | undefined;

function setup(opts: { table?: Map<string, Uint8Array>; lockBusy?: boolean; now?: () => number } = {}) {
  const port = new FakeSerialPort(opts.table ?? B21S);
  const task = new FakeTask();
  let client: B21SerialClient | undefined;
  const released = { count: 0 };
  const deps: SessionDeps = {
    createClient: () => {
      client = new B21SerialClient(async () => port);
      client.setPacketInterval(0);
      return client;
    },
    lock: async () => (opts.lockBusy ? null : () => void released.count++),
    newPrintTask: () => task as unknown as AbstractPrintTask,
    now: opts.now,
  };
  session = new PrinterSession(deps);
  return { session, port, task, released, client: () => client! };
}

afterEach(async () => {
  await session?.disconnect();
  vi.restoreAllMocks();
});

describe("PrinterSession connection", () => {
  it("connects, identifies the B21S and reads RFID", async () => {
    const { session } = setup();
    const states: string[] = [];
    session.subscribe((s) => states.push(s.state));
    await session.connect();
    const s = session.getStatus();
    expect(s.state).toBe("ready");
    expect(s.identity).toMatchObject({ modelId: 777, model: "B21S", serial: "G626070087" });
    expect(s.identity?.firmware).toMatch(/40\.28/);
    expect(s.rfid?.barCode).toBeTruthy();
    expect(states.filter((s, i) => s !== states[i - 1])).toEqual(["disconnected", "connecting", "ready"]);
  });

  it("rejects printers other than the B21S and closes the port", async () => {
    const { session, port, released } = setup({ table: OTHER_MODEL });
    await session.connect();
    expect(session.getStatus()).toMatchObject({ state: "error" });
    expect(session.getStatus().error).toMatch(/Unsupported printer \(model id 257\)/);
    expect(port.isOpen).toBe(false);
    expect(released.count).toBe(1);
  });

  it("refuses to connect when another tab holds the printer", async () => {
    const { session, port } = setup({ lockBusy: true });
    await session.connect();
    expect(session.getStatus().error).toMatch(/another tab/);
    expect(port.opens).toBe(0);
  });

  it("disconnect releases the port, lock and listeners", async () => {
    const { session, port, released, client } = setup();
    await session.connect();
    const c = client();
    await session.disconnect();
    expect(session.getStatus().state).toBe("disconnected");
    expect(port.isOpen).toBe(false);
    expect(port.listeners.get("disconnect")).toBe(0);
    expect(released.count).toBe(1);
    expect(c.listenerCount("heartbeat")).toBe(0);
    expect(c.listenerCount("rfidinfofetched")).toBe(0);
    // The library's own constructor keeps one internal "disconnect" handler.
    expect(c.listenerCount("disconnect")).toBe(1);
  });

  it("unplugging returns to disconnected and allows reconnecting", async () => {
    const { session, port } = setup();
    await session.connect();
    const done = new Promise<void>((r) => {
      const off = session.subscribe((s) => {
        if (s.state === "disconnected") {
          off();
          r();
        }
      });
    });
    port.unplug();
    await done;
    await session.connect();
    expect(session.getStatus().state).toBe("ready");
  });
});

describe("PrinterSession heartbeat cadence", () => {
  it("polls fast while active, slower when idle, and not at all when hidden", async () => {
    let t = 1_000_000;
    const { session, client } = setup({ now: () => t });
    await session.connect();
    const c = client();
    expect(c.getHeartbeatInterval()).toBe(HEARTBEAT_ACTIVE_MS);
    expect((c as unknown as { heartbeatTimer?: unknown }).heartbeatTimer).toBeDefined();

    t += ACTIVE_WINDOW_MS + 1;
    await new Promise((r) => setTimeout(r, 1_100));
    expect(c.getHeartbeatInterval()).toBe(HEARTBEAT_IDLE_MS);

    session.setVisible(false);
    expect((c as unknown as { heartbeatTimer?: unknown }).heartbeatTimer).toBeUndefined();

    session.setVisible(true);
    expect(c.getHeartbeatInterval()).toBe(HEARTBEAT_ACTIVE_MS);
    expect((c as unknown as { heartbeatTimer?: unknown }).heartbeatTimer).toBeDefined();
  });
});

describe("PrinterSession printing", () => {
  it("prints every label with its copies and ends the job", async () => {
    const { session, task } = setup();
    await session.connect();
    const progress: number[] = [];
    session.subscribe((s) => s.progress && progress.push(s.progress.done));
    const out = await session.print(job(3, 2));
    expect(out).toEqual({ status: "completed", printed: 3 });
    expect(task.calls).toEqual(["init", "page1x2", "page2x2", "page3x2", "end"]);
    expect(session.getStatus().state).toBe("ready");
    expect(progress.at(-1)).toBe(3);
  });

  it("cancel stops after the current label and still ends the job", async () => {
    const { session, task } = setup();
    await session.connect();
    task.autoFinish = false;
    const running = session.print(job(5));
    await vi.waitFor(() => expect(task.pageGates.length).toBe(1));
    const cancelled = session.cancel();
    expect(session.getStatus().state).toBe("cancelling");
    task.pageGates[0]!.resolve();
    await cancelled;
    const out: JobOutcome = await running;
    expect(out).toEqual({ status: "cancelled", printed: 1 });
    expect(task.calls).toEqual(["init", "page1x1", "end"]);
    expect(session.getStatus().state).toBe("ready");
  });

  it("reports printer errors, ends the job and does not resend", async () => {
    const { session, task } = setup();
    await session.connect();
    task.failOnPage = 2;
    const out = await session.print(job(3));
    expect(out).toEqual({ status: "failed", printed: 1, error: "The printer lid is open." });
    expect(task.calls).toEqual(["init", "page1x1", "page2x1", "end"]);
    expect(session.getStatus()).toMatchObject({ state: "ready", error: "The printer lid is open." });
  });

  it("allows only one job at a time and validates parameters", async () => {
    const { session, task } = setup();
    await expect(session.print(job(1))).rejects.toThrow(/not ready/);
    await session.connect();
    task.autoFinish = false;
    const first = session.print(job(1));
    await expect(session.print(job(1))).rejects.toThrow(/already printing/);
    await vi.waitFor(() => expect(task.pageGates.length).toBe(1));
    task.pageGates[0]!.resolve();
    await first;
    await expect(session.print(job(0))).rejects.toThrow(/Nothing/);
    await expect(session.print(job(1, 101))).rejects.toThrow(/Copies/);
    await expect(session.print({ ...job(1), density: 6 })).rejects.toThrow(/Density/);
  });

  it("an unplug mid-job ends in an error state", async () => {
    const { session, task, port } = setup();
    await session.connect();
    task.autoFinish = false;
    const running = session.print(job(2));
    await vi.waitFor(() => expect(task.pageGates.length).toBe(1));
    port.unplug();
    await vi.waitFor(() => expect(session.getStatus().state).toBe("error"));
    task.pageGates[0]!.resolve();
    await running;
    expect(session.getStatus().error).toMatch(/disconnected/);
  });
});

describe("PrinterSession diagnostics", () => {
  it("packet logging is off by default and bounded when on", async () => {
    const { session } = setup();
    await session.connect();
    expect(session.getPacketLog()).toEqual([]);
    session.setPacketLogging(true);
    await session.refreshRfid();
    const log = session.getPacketLog();
    expect(log.some((e) => e.dir === ">>" && e.hex.startsWith("55 55 1a"))).toBe(true);
    expect(log.some((e) => e.dir === "<<" && e.hex.startsWith("55 55 1b"))).toBe(true);
    expect(log.length).toBeLessThanOrEqual(500);
    session.setPacketLogging(false);
    expect(session.getPacketLog()).toEqual([]);
  });

  it("paper info resolves to undefined when the printer does not answer", async () => {
    const { session } = setup();
    expect(await session.readPaperInfo()).toBeUndefined();
    await session.connect();
    expect(await session.readPaperInfo()).toBeUndefined();
  });
});

describe("labelTypeFor", () => {
  it("uses the transparent media setting for clear stock", () => {
    expect(labelTypeFor("clear")).toBe(LabelType.Transparent);
    expect(labelTypeFor("white")).toBe(LabelType.WithGaps);
    expect(labelTypeFor("printed")).toBe(LabelType.WithGaps);
  });
});
