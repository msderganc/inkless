import {
  type AbstractPrintTask,
  type EncodedImage,
  type HeartbeatData,
  LabelType,
  type NiimbotAbstractClient,
  type NiimbotPacket,
  type PaperInfo,
  PrintError,
  PrinterErrorCode,
  type PrintOptions,
  type RfidInfo,
} from "@mmote/niimbluelib";

import { RingLog } from "../ring-log";

export const PACKET_LOG_SIZE = 500;

export interface PacketLogEntry {
  time: number;
  dir: ">>" | "<<";
  hex: string;
}

/** B21S model ids (NiimBlueLib printer_models: B21S = 777, B21S_C2B = 776). */
export const SUPPORTED_MODEL_IDS = [777, 776] as const;
export const DEFAULT_DENSITY = 3; // B21S model default (V4), not the library's print default of 2.

export type SessionState = "disconnected" | "connecting" | "ready" | "printing" | "cancelling" | "error";

export interface PrinterIdentity {
  modelId?: number;
  model?: string;
  firmware?: string;
  hardware?: string;
  serial?: string;
}

export interface JobProgress {
  /** Labels (pages) fully printed. */
  done: number;
  total: number;
}

export interface SessionStatus {
  state: SessionState;
  error?: string;
  identity?: PrinterIdentity;
  rfid?: RfidInfo;
  heartbeat?: HeartbeatData;
  progress?: JobProgress;
}

export interface PrintJob {
  /** Number of distinct labels (batch values). */
  pageCount: number;
  /** Copies of each label. */
  copies: number;
  density: number;
  labelType: LabelType;
  /** Render label `index` on demand so big batches never sit in memory at once. */
  renderPage(index: number): Promise<EncodedImage>;
}

export type JobOutcome = { status: "completed" | "cancelled"; printed: number } | { status: "failed"; printed: number; error: string };

/** Exclusive ownership of the printer across tabs (V8). Returns a release function, or null if busy. */
export type LockProvider = () => Promise<(() => void) | null>;

export interface SessionDeps {
  createClient(): NiimbotAbstractClient;
  lock?: LockProvider;
  newPrintTask?(client: NiimbotAbstractClient, options: Partial<PrintOptions>): AbstractPrintTask;
  now?(): number;
}

/** Heartbeat cadence: frequent only around activity, slower when idle, none when hidden. */
export const HEARTBEAT_ACTIVE_MS = 2_000;
export const HEARTBEAT_IDLE_MS = 10_000;
export const ACTIVE_WINDOW_MS = 30_000;

export const MAX_COPIES = 100;

const ERROR_TEXT: Partial<Record<number, string>> = {
  [PrinterErrorCode.CoverOpen]: "The printer lid is open.",
  [PrinterErrorCode.LackPaper]: "The printer is out of labels.",
  [PrinterErrorCode.PaperOutException]: "Label feed problem. Check the roll.",
  [PrinterErrorCode.LowBattery]: "The printer battery is low.",
  [PrinterErrorCode.Overheat]: "The printhead is too hot. Wait a minute and try again.",
  [PrinterErrorCode.PrinterBusy]: "The printer is busy.",
  [PrinterErrorCode.WrongPaper]: "The label roll does not match.",
  [PrinterErrorCode.ECheckPaper]: "Check the label roll.",
  [PrinterErrorCode.Disconnect]: "The printer disconnected.",
};

export function describeError(e: unknown): string {
  if (e instanceof PrintError) {
    return ERROR_TEXT[e.reasonId] ?? `Printer error ${e.reasonId} (${PrinterErrorCode[e.reasonId] ?? "unknown"}).`;
  }
  if (e instanceof DOMException) {
    if (e.name === "NotFoundError") return "No printer was selected.";
    if (e.name === "InvalidStateError" || e.name === "NetworkError") {
      return "The printer port is in use or unavailable. Close the NIIMBOT app and other tabs, then try again.";
    }
    if (e.name === "SecurityError") return "The browser blocked access to the printer.";
  }
  if (e instanceof Error) {
    if (/timeout/i.test(e.message)) return "The printer did not respond in time.";
    return e.message;
  }
  return String(e);
}

/** Browser Web Locks provider; falls back to no locking where unsupported. */
export function webLockProvider(name = "b21s-printer"): LockProvider {
  return async () => {
    if (typeof navigator === "undefined" || !("locks" in navigator)) return () => undefined;
    return new Promise<(() => void) | null>((resolveAcquire) => {
      void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolveAcquire(null);
          return;
        }
        return new Promise<void>((release) => resolveAcquire(() => release()));
      });
    });
  };
}

/**
 * One printer connection and at most one job at a time. Owns the client's lifecycle: listeners,
 * heartbeat cadence, cross-tab lock, and cancellation (stop after the current label, V2).
 */
export class PrinterSession {
  private status: SessionStatus = { state: "disconnected" };
  private client?: NiimbotAbstractClient;
  private releaseLock?: () => void;
  private readonly subscribers = new Set<(s: SessionStatus) => void>();
  private cancelRequested = false;
  private visible = true;
  private lastActivity = 0;
  private cadenceTimer?: ReturnType<typeof setInterval>;
  private detach: (() => void)[] = [];

  constructor(private readonly deps: SessionDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  subscribe(fn: (s: SessionStatus) => void): () => void {
    this.subscribers.add(fn);
    fn(this.status);
    return () => this.subscribers.delete(fn);
  }

  private set(patch: Partial<SessionStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.subscribers) fn(this.status);
  }

  async connect(): Promise<void> {
    if (this.status.state !== "disconnected" && this.status.state !== "error") return;
    this.set({ state: "connecting", error: undefined, progress: undefined });

    const release = await (this.deps.lock ?? (async () => () => undefined))();
    if (!release) {
      this.set({ state: "error", error: "The printer is already in use in another tab or window." });
      return;
    }
    this.releaseLock = release;

    const client = this.deps.createClient();
    this.client = client;
    this.wire(client);
    try {
      client.setHeartbeatAutoStart(false);
      await client.connect();
      const info = client.getPrinterInfo();
      const modelId = info.modelId;
      if (modelId === undefined || !(SUPPORTED_MODEL_IDS as readonly number[]).includes(modelId)) {
        throw new Error(`Unsupported printer (model id ${modelId ?? "unknown"}). This app supports the NIIMBOT B21S.`);
      }
      if (client.getPrintTaskType() !== "D110") {
        throw new Error("Unexpected print protocol for this printer model.");
      }
      this.set({
        state: "ready",
        identity: {
          modelId,
          model: client.getModelMetadata()?.model,
          firmware: info.softwareVersion,
          hardware: info.hardwareVersion,
          serial: info.serial,
        },
        rfid: client.getRfidInfo().labelRfidInfo,
      });
      this.touch();
      this.cadenceTimer = setInterval(() => this.applyCadence(), 1_000);
    } catch (e) {
      await this.teardown();
      this.set({ state: "error", error: describeError(e) });
    }
  }

  private wire(client: NiimbotAbstractClient) {
    const onDisconnect = () => {
      if (this.client !== client) return;
      const midJob = this.status.state === "printing" || this.status.state === "cancelling";
      void this.teardown().then(() =>
        this.set(
          midJob
            ? { state: "error", error: "The printer disconnected while printing.", heartbeat: undefined }
            : { state: "disconnected", heartbeat: undefined },
        ),
      );
    };
    const onHeartbeat = (e: { data: HeartbeatData }) => this.set({ heartbeat: e.data });
    const onRfid = (e: { info: { labelRfidInfo?: RfidInfo } }) => this.set({ rfid: e.info.labelRfidInfo });
    const onSent = (e: { packet: NiimbotPacket }) => this.logPacket(">>", e.packet);
    const onReceived = (e: { packet: NiimbotPacket }) => this.logPacket("<<", e.packet);
    client.on("disconnect", onDisconnect);
    client.on("heartbeat", onHeartbeat);
    client.on("rfidinfofetched", onRfid);
    client.on("packetsent", onSent);
    client.on("packetreceived", onReceived);
    this.detach.push(() => {
      client.off("disconnect", onDisconnect);
      client.off("heartbeat", onHeartbeat);
      client.off("rfidinfofetched", onRfid);
      client.off("packetsent", onSent);
      client.off("packetreceived", onReceived);
    });
  }

  private packetLog?: RingLog<PacketLogEntry>;

  /** Opt-in troubleshooting log of the last PACKET_LOG_SIZE packets (off by default). */
  setPacketLogging(enabled: boolean) {
    this.packetLog = enabled ? (this.packetLog ?? new RingLog(PACKET_LOG_SIZE)) : undefined;
  }

  getPacketLog(): PacketLogEntry[] {
    return this.packetLog?.toArray() ?? [];
  }

  private logPacket(dir: ">>" | "<<", packet: NiimbotPacket) {
    if (!this.packetLog) return;
    const hex = [...packet.toBytes()].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    this.packetLog.push({ time: this.now(), dir, hex });
  }

  /** Media info reported by the printer, if this model answers (V1: unverified on B21S). */
  async readPaperInfo(): Promise<PaperInfo | undefined> {
    if (this.status.state !== "ready" || !this.client) return undefined;
    this.touch();
    return this.client.protocol.getPaperInfo().catch(() => undefined);
  }

  /** Re-read the roll's RFID tag. */
  async refreshRfid(): Promise<void> {
    if (this.status.state !== "ready" || !this.client) return;
    this.touch();
    await this.client.fetchRfidInfo();
  }

  /** Report page visibility; heartbeat stops while hidden. */
  setVisible(visible: boolean) {
    this.visible = visible;
    if (visible) this.touch();
    else this.applyCadence();
  }

  /** Mark user activity so status is polled more often for a while. */
  touch() {
    this.lastActivity = this.now();
    this.applyCadence();
  }

  private currentInterval(): number | null {
    if (!this.visible && this.status.state !== "printing" && this.status.state !== "cancelling") return null;
    const active =
      this.status.state === "printing" ||
      this.status.state === "cancelling" ||
      this.now() - this.lastActivity < ACTIVE_WINDOW_MS;
    return active ? HEARTBEAT_ACTIVE_MS : HEARTBEAT_IDLE_MS;
  }

  private appliedInterval: number | null = null;

  private applyCadence() {
    const client = this.client;
    if (!client?.isConnected() || this.status.state === "connecting") return;
    // The print task polls status itself; a heartbeat during a job would only compete for the line.
    const want = this.status.state === "printing" || this.status.state === "cancelling" ? null : this.currentInterval();
    if (want === this.appliedInterval) return;
    this.appliedInterval = want;
    client.stopHeartbeat();
    if (want !== null) {
      client.setHeartbeatInterval(want);
      client.startHeartbeat();
    }
  }

  async disconnect(): Promise<void> {
    if (this.status.state === "printing") await this.cancel();
    await this.teardown();
    this.set({ state: "disconnected", error: undefined, heartbeat: undefined, progress: undefined });
  }

  private async teardown() {
    if (this.cadenceTimer) clearInterval(this.cadenceTimer);
    this.cadenceTimer = undefined;
    this.appliedInterval = null;
    const client = this.client;
    this.client = undefined;
    for (const d of this.detach) d();
    this.detach = [];
    if (client) {
      client.stopHeartbeat();
      await client.disconnect().catch(() => undefined);
    }
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  private running?: Promise<JobOutcome>;

  /** Request cancellation: stops after the label currently printing (V2). Resolves when the job ends. */
  async cancel(): Promise<void> {
    if (this.status.state !== "printing") return;
    this.cancelRequested = true;
    this.set({ state: "cancelling" });
    await this.running?.catch(() => undefined);
  }

  /** Print a job. Rejects immediately if the printer is not ready (queue length 1). */
  print(job: PrintJob): Promise<JobOutcome> {
    const client = this.client;
    if (this.status.state !== "ready" || !client) {
      return Promise.reject(new Error(this.status.state === "printing" ? "A job is already printing." : "The printer is not ready."));
    }
    if (!(job.pageCount >= 1)) return Promise.reject(new Error("Nothing to print."));
    if (!(job.copies >= 1 && job.copies <= MAX_COPIES)) {
      return Promise.reject(new Error(`Copies must be between 1 and ${MAX_COPIES}.`));
    }
    if (!(job.density >= 1 && job.density <= 5)) return Promise.reject(new Error("Density must be between 1 and 5."));

    this.cancelRequested = false;
    this.set({ state: "printing", error: undefined, progress: { done: 0, total: job.pageCount } });
    this.applyCadence();
    this.running = this.run(client, job).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(client: NiimbotAbstractClient, job: PrintJob): Promise<JobOutcome> {
    const options: Partial<PrintOptions> = {
      density: job.density,
      labelType: job.labelType,
      totalPages: job.pageCount * job.copies,
      statusTimeoutMs: 10_000,
      pageTimeoutMs: 15_000,
    };
    const task = this.deps.newPrintTask
      ? this.deps.newPrintTask(client, options)
      : client.protocol.newPrintTask("D110", options);
    let printed = 0;
    let outcome: JobOutcome;
    try {
      await task.printInit();
      for (let i = 0; i < job.pageCount; i++) {
        if (this.cancelRequested) break;
        if (!client.isConnected()) throw new Error("The printer disconnected.");
        const image = await job.renderPage(i);
        await task.printPage(image, job.copies);
        await task.waitForPageFinished();
        printed++;
        this.set({ progress: { done: printed, total: job.pageCount } });
      }
      outcome = { status: this.cancelRequested ? "cancelled" : "completed", printed };
    } catch (e) {
      outcome = { status: "failed", printed, error: describeError(e) };
    }
    // Always end the print session on the printer; never resend pages automatically.
    try {
      await task.printEnd();
    } catch {
      // The printer may already have ended or gone away.
    }
    this.cancelRequested = false;
    if (this.client === client && client.isConnected()) {
      this.set({ state: "ready", error: outcome.status === "failed" ? outcome.error : undefined });
      this.touch();
    } else if (this.status.state !== "disconnected") {
      this.set({ state: "error", error: outcome.status === "failed" ? outcome.error : "The printer disconnected." });
    }
    return outcome;
  }
}

/** LabelType for a stock colour: clear rolls use the transparent media setting. */
export function labelTypeFor(stock: "white" | "clear" | "printed"): LabelType {
  return stock === "clear" ? LabelType.Transparent : LabelType.WithGaps;
}
