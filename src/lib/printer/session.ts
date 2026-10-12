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
import { B21SPrintTask } from "./b21s-task";

export const PACKET_LOG_SIZE = 500;

export interface PacketLogEntry {
  time: number;
  dir: ">>" | "<<";
  hex: string;
}

/** B21S model ids (NiimBlueLib printer_models: B21S = 777, B21S_C2B = 776). */
export const SUPPORTED_MODEL_IDS = [777, 776] as const;
export const DEFAULT_DENSITY = 3; // B21S model default (V4), not the library's print default of 2.

export type SessionState =
  "disconnected" | "connecting" | "ready" | "printing" | "cancelling" | "error";

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

export type JobOutcome =
  | { status: "completed" | "cancelled"; printed: number }
  | { status: "failed"; printed: number; error: string };

/** Exclusive ownership of the printer across tabs (V8). Returns a release function, or null if busy. */
export type LockProvider = () => Promise<(() => void) | null>;

export interface ConnectOptions {
  /**
   * Automatic reconnect (page load, printer plugged back in): never prompt the user to pick a
   * port, and fall back quietly to "disconnected" instead of showing an error.
   */
  auto?: boolean;
}

export interface SessionDeps {
  createClient(options: ConnectOptions): NiimbotAbstractClient;
  lock?: LockProvider;
  newPrintTask?(
    client: NiimbotAbstractClient,
    options: Partial<PrintOptions>,
  ): AbstractPrintTask;
  now?(): number;
  /** Per-label completion deadline (default PAGE_DEADLINE_BASE_MS + PAGE_DEADLINE_PER_COPY_MS × copies). */
  pageDeadlineMs?(copies: number): number;
}

/** Heartbeat cadence: frequent only around activity, slower when idle, none when hidden. */
export const HEARTBEAT_ACTIVE_MS = 2_000;
export const HEARTBEAT_IDLE_MS = 10_000;
export const ACTIVE_WINDOW_MS = 30_000;

export const MAX_COPIES = 100;

/** Default per-label completion deadline: generous for 100 copies of an 80 mm label. */
export const PAGE_DEADLINE_BASE_MS = 20_000;
export const PAGE_DEADLINE_PER_COPY_MS = 5_000;

const ERROR_TEXT: Partial<Record<number, string>> = {
  [PrinterErrorCode.CoverOpen]: "The printer lid is open.",
  [PrinterErrorCode.LackPaper]: "The printer is out of labels.",
  [PrinterErrorCode.PaperOutException]: "Label feed problem. Check the roll.",
  [PrinterErrorCode.LowBattery]: "The printer battery is low.",
  [PrinterErrorCode.Overheat]:
    "The printhead is too hot. Wait a minute and try again.",
  [PrinterErrorCode.PrinterBusy]: "The printer is busy.",
  [PrinterErrorCode.WrongPaper]: "The label roll does not match.",
  [PrinterErrorCode.ECheckPaper]: "Check the label roll.",
  [PrinterErrorCode.Disconnect]: "The printer disconnected.",
};

export function describeError(e: unknown): string {
  if (e instanceof PrintError) {
    return (
      ERROR_TEXT[e.reasonId] ??
      `Printer error ${e.reasonId} (${PrinterErrorCode[e.reasonId] ?? "unknown"}).`
    );
  }
  if (e instanceof DOMException) {
    if (e.name === "NotFoundError") return "No printer was selected.";
    if (e.name === "InvalidStateError" || e.name === "NetworkError") {
      return "The printer port is in use or unavailable. Close the NIIMBOT app and other tabs, then try again.";
    }
    if (e.name === "SecurityError")
      return "The browser blocked access to the printer.";
  }
  if (e instanceof Error) {
    if (/timeout/i.test(e.message))
      return "The printer did not respond in time.";
    return e.message;
  }
  return String(e);
}

/** Browser Web Locks provider; falls back to no locking where unsupported. */
export function webLockProvider(name = "b21s-printer"): LockProvider {
  return async () => {
    if (typeof navigator === "undefined" || !("locks" in navigator))
      return () => undefined;
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

/** Per-job cancellation flag and abort signal. */
class JobControl {
  cancelled = false;
  private rejectAbort!: (e: Error) => void;
  private readonly aborted = new Promise<never>(
    (_, reject) => (this.rejectAbort = reject),
  );

  constructor() {
    this.aborted.catch(() => undefined);
  }

  abort(e: Error) {
    this.cancelled = true;
    this.rejectAbort(e);
  }

  /** Resolve with `p`, or reject as soon as the job is aborted. */
  guard<T>(p: Promise<T>): Promise<T> {
    return Promise.race([p, this.aborted]);
  }
}

function withDeadline<T>(
  p: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(
        new Error(
          "The printer did not finish the label in time. Check the roll and the lid.",
        ),
      );
    }, ms);
  });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
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
  private visible = true;
  private lastActivity = 0;
  private cadenceTimer?: ReturnType<typeof setInterval>;
  private appliedInterval: number | null = null;
  private detach: (() => void)[] = [];
  /** Connection generation: bumped by every connect and disconnect so stale attempts back off. */
  private attempt = 0;
  private connecting?: Promise<void>;
  private running?: Promise<JobOutcome>;
  private job?: JobControl;
  private packetLog?: RingLog<PacketLogEntry>;

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

  /** Connect to the printer. Concurrent calls share one attempt; disconnect() cancels it. */
  connect(options: ConnectOptions = {}): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.status.state !== "disconnected" && this.status.state !== "error")
      return Promise.resolve();
    const gen = ++this.attempt;
    this.connecting = this.doConnect(gen, options).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async doConnect(gen: number, options: ConnectOptions): Promise<void> {
    const stale = () => gen !== this.attempt;
    // Automatic attempts fail quietly: the user did not ask, so there is nothing to report.
    const fail = (error: string) =>
      this.set(
        options.auto
          ? { state: "disconnected", error: undefined }
          : { state: "error", error },
      );
    this.set({ state: "connecting", error: undefined, progress: undefined });

    let release: (() => void) | null;
    try {
      release = await (this.deps.lock ?? (async () => () => undefined))();
    } catch (e) {
      if (!stale()) fail(describeError(e));
      return;
    }
    if (stale()) {
      release?.();
      return;
    }
    if (!release) {
      fail("The printer is already in use in another tab or window.");
      return;
    }
    this.releaseLock = release;

    const client = this.deps.createClient(options);
    this.client = client;
    try {
      client.setHeartbeatAutoStart(false);
      await client.connect();
      if (stale()) {
        // disconnect() ran meanwhile and released the lock; make sure this port is closed too.
        await client.disconnect().catch(() => undefined);
        return;
      }
      const info = client.getPrinterInfo();
      const modelId = info.modelId;
      if (
        modelId === undefined ||
        !(SUPPORTED_MODEL_IDS as readonly number[]).includes(modelId)
      ) {
        throw new Error(
          `Unsupported printer (model id ${modelId ?? "unknown"}). This app supports the NIIMBOT B21S.`,
        );
      }
      if (client.getPrintTaskType() !== "D110") {
        throw new Error("Unexpected print protocol for this printer model.");
      }
      // Wire only after a successful connect so a failed negotiation cannot race the error state.
      this.wire(client);
      if (!client.isConnected()) throw new Error("The printer disconnected.");
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
      if (stale()) return;
      await this.teardown();
      if (!stale()) fail(describeError(e));
    }
  }

  private wire(client: NiimbotAbstractClient) {
    const onDisconnect = () => {
      if (this.client !== client) return;
      const midJob =
        this.status.state === "printing" || this.status.state === "cancelling";
      this.job?.abort(new Error("The printer disconnected while printing."));
      void this.teardown().then(() =>
        this.set(
          midJob
            ? {
                state: "error",
                error: "The printer disconnected while printing.",
                heartbeat: undefined,
              }
            : { state: "disconnected", heartbeat: undefined },
        ),
      );
    };
    const onHeartbeat = (e: { data: HeartbeatData }) =>
      this.set({ heartbeat: e.data });
    const onRfid = (e: { info: { labelRfidInfo?: RfidInfo } }) =>
      this.set({ rfid: e.info.labelRfidInfo });
    const onSent = (e: { packet: NiimbotPacket }) =>
      this.logPacket(">>", e.packet);
    const onReceived = (e: { packet: NiimbotPacket }) =>
      this.logPacket("<<", e.packet);
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

  /** Opt-in troubleshooting log of the last PACKET_LOG_SIZE packets (off by default). */
  setPacketLogging(enabled: boolean) {
    this.packetLog = enabled
      ? (this.packetLog ?? new RingLog(PACKET_LOG_SIZE))
      : undefined;
  }

  getPacketLog(): PacketLogEntry[] {
    return this.packetLog?.toArray() ?? [];
  }

  private logPacket(dir: ">>" | "<<", packet: NiimbotPacket) {
    if (!this.packetLog) return;
    const hex = [...packet.toBytes()]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    this.packetLog.push({ time: this.now(), dir, hex });
  }

  private readyClient(): NiimbotAbstractClient | undefined {
    return this.status.state === "ready" && this.client?.isConnected()
      ? this.client
      : undefined;
  }

  /** Media info reported by the printer, if this model answers (V1: unverified on B21S). */
  async readPaperInfo(): Promise<PaperInfo | undefined> {
    const client = this.readyClient();
    if (!client) return undefined;
    this.touch();
    return client.protocol.getPaperInfo().catch(() => undefined);
  }

  /** Re-read the roll's RFID tag. */
  async refreshRfid(): Promise<void> {
    const client = this.readyClient();
    if (!client) return;
    this.touch();
    await client.fetchRfidInfo();
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

  private applyCadence() {
    const client = this.client;
    if (!client?.isConnected() || this.status.state === "connecting") return;
    const busy =
      this.status.state === "printing" || this.status.state === "cancelling";
    // During a job the print task polls status itself; a heartbeat would only compete for the line.
    let want: number | null = null;
    if (!busy && this.visible) {
      want =
        this.now() - this.lastActivity < ACTIVE_WINDOW_MS
          ? HEARTBEAT_ACTIVE_MS
          : HEARTBEAT_IDLE_MS;
    }
    if (want === this.appliedInterval) return;
    this.appliedInterval = want;
    client.stopHeartbeat();
    if (want !== null) {
      client.setHeartbeatInterval(want);
      client.startHeartbeat();
    }
  }

  /**
   * Disconnect. Cancels a connect in progress and aborts a running job (never resent), then
   * releases the port, listeners, timers and cross-tab lock.
   */
  async disconnect(): Promise<void> {
    this.attempt++;
    this.job?.abort(new Error("Disconnected."));
    await this.teardown();
    await this.running?.catch(() => undefined);
    this.set({
      state: "disconnected",
      error: undefined,
      heartbeat: undefined,
      progress: undefined,
    });
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
      client.protocol.cancelStatusPoll();
      await client.disconnect().catch(() => undefined);
    }
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  /** Request cancellation: stops after the label currently printing (V2). Resolves when the job ends. */
  async cancel(): Promise<void> {
    if (this.job && this.status.state === "printing") {
      this.job.cancelled = true;
      this.set({ state: "cancelling" });
    }
    await this.running?.catch(() => undefined);
  }

  /** Print a job. Rejects immediately if the printer is not ready (queue length 1). */
  print(job: PrintJob): Promise<JobOutcome> {
    const client = this.client;
    if (this.running)
      return Promise.reject(new Error("A job is already printing."));
    if (this.status.state !== "ready" || !client?.isConnected()) {
      return Promise.reject(new Error("The printer is not ready."));
    }
    if (!(job.pageCount >= 1))
      return Promise.reject(new Error("Nothing to print."));
    if (!(job.copies >= 1 && job.copies <= MAX_COPIES)) {
      return Promise.reject(
        new Error(`Copies must be between 1 and ${MAX_COPIES}.`),
      );
    }
    if (!(job.density >= 1 && job.density <= 5))
      return Promise.reject(new Error("Density must be between 1 and 5."));

    const control = new JobControl();
    this.job = control;
    this.set({
      state: "printing",
      error: undefined,
      progress: { done: 0, total: job.pageCount },
    });
    this.applyCadence();
    this.running = this.run(client, job, control).finally(() => {
      this.running = undefined;
      if (this.job === control) this.job = undefined;
    });
    return this.running;
  }

  private async run(
    client: NiimbotAbstractClient,
    job: PrintJob,
    control: JobControl,
  ): Promise<JobOutcome> {
    const options: Partial<PrintOptions> = {
      density: job.density,
      labelType: job.labelType,
      totalPages: job.pageCount * job.copies,
      statusTimeoutMs: 10_000,
      pageTimeoutMs: 15_000,
    };
    const task = this.deps.newPrintTask
      ? this.deps.newPrintTask(client, options)
      : new B21SPrintTask(client.protocol, options);
    const deadline =
      this.deps.pageDeadlineMs?.(job.copies) ??
      PAGE_DEADLINE_BASE_MS + PAGE_DEADLINE_PER_COPY_MS * job.copies;
    let printed = 0;
    let outcome: JobOutcome;
    try {
      await control.guard(task.printInit());
      for (let i = 0; i < job.pageCount; i++) {
        if (control.cancelled) break;
        if (!client.isConnected()) throw new Error("The printer disconnected.");
        const image = await control.guard(job.renderPage(i));
        await control.guard(task.printPage(image, job.copies));
        // A stalled feed keeps answering status polls without finishing, so bound every label.
        await control.guard(
          withDeadline(task.waitForPageFinished(), deadline, () =>
            client.protocol.cancelStatusPoll(),
          ),
        );
        printed++;
        if (this.client === client)
          this.set({ progress: { done: printed, total: job.pageCount } });
      }
      outcome = {
        status: control.cancelled ? "cancelled" : "completed",
        printed,
      };
    } catch (e) {
      outcome = { status: "failed", printed, error: describeError(e) };
    }
    // Always end the print session on the printer; never resend pages automatically.
    if (client.isConnected()) {
      try {
        await control.guard(task.printEnd());
      } catch {
        // The printer may already have ended or gone away.
      }
    }
    // Touch session state only while this job's connection is still current; otherwise the
    // disconnect/unplug path, or a newer connection, owns it.
    if (this.client === client && client.isConnected()) {
      this.set({
        state: "ready",
        error: outcome.status === "failed" ? outcome.error : undefined,
      });
      this.touch();
    }
    return outcome;
  }
}

/** LabelType for a stock colour: clear rolls use the transparent media setting. */
export function labelTypeFor(stock: "white" | "clear" | "printed"): LabelType {
  return stock === "clear" ? LabelType.Transparent : LabelType.WithGaps;
}
