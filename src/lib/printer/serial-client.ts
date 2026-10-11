import { type ConnectionInfo, ConnectResult, ConnectEvent, DisconnectEvent, NiimbotAbstractClient } from "@mmote/niimbluelib";

/** USB IDs of the NIIMBOT serial interface (spec: `USB\VID_3513&PID_0002`). */
export const NIIMBOT_USB_VENDOR_ID = 0x3513;

/** Minimal Web Serial port surface (lets tests supply a fake port). */
export interface SerialPortLike extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

export type PortSource = () => Promise<SerialPortLike>;

/**
 * Web Serial client for the B21S, replacing NiimBlueLib's `NiimbotSerialClient` to fix its
 * lifecycle gaps (validation V3):
 *  - the port `disconnect` listener is removed on every disconnect instead of accumulating;
 *  - the reader is cancelled before its lock is released and the read loop is awaited;
 *  - a failed negotiation is cleaned up before `connect()` rejects;
 *  - disconnect is idempotent and emits `disconnect` exactly once per connection.
 */
export class B21SerialClient extends NiimbotAbstractClient {
  private port?: SerialPortLike;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private readLoop?: Promise<void>;
  private onPortDisconnect?: () => void;
  private closing?: Promise<void>;

  constructor(private readonly portSource: PortSource) {
    super();
  }

  public async connect(): Promise<ConnectionInfo> {
    await this.disconnect();

    const port = await this.portSource();
    await port.open({ baudRate: 115200 });
    if (!port.readable || !port.writable) {
      await port.close().catch(() => undefined);
      throw new Error("Port is not readable/writable");
    }

    this.port = port;
    this.onPortDisconnect = () => void this.disconnect();
    port.addEventListener("disconnect", this.onPortDisconnect);
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    this.readLoop = this.pump(this.reader);

    try {
      await this.negotiateAndGetPrinterInfo();
    } catch (e) {
      await this.disconnect();
      throw e;
    }

    const info = port.getInfo();
    const result: ConnectionInfo = {
      deviceName: `USB ${info.usbVendorId?.toString(16) ?? "?"}:${info.usbProductId?.toString(16) ?? "?"}`,
      result: this.printerInfo.connectResult ?? ConnectResult.FirmwareErrors,
    };
    this.emit("connect", new ConnectEvent(result));
    return result;
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        // Device lost or stream errored: tear down so the app sees a clean "disconnected" state.
        void this.disconnect();
        return;
      }
      if (chunk.done) return;
      if (chunk.value?.length) this.processRawPacket(chunk.value);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.closing) return this.closing;
    if (!this.port) return;
    this.closing = this.teardown().finally(() => (this.closing = undefined));
    return this.closing;
  }

  private async teardown(): Promise<void> {
    const port = this.port!;
    this.stopHeartbeat();
    if (this.onPortDisconnect) port.removeEventListener("disconnect", this.onPortDisconnect);
    this.onPortDisconnect = undefined;

    const reader = this.reader;
    const writer = this.writer;
    this.reader = undefined;
    this.writer = undefined;

    if (reader) {
      await reader.cancel().catch(() => undefined);
      await this.readLoop?.catch(() => undefined);
      reader.releaseLock();
    }
    this.readLoop = undefined;
    if (writer) {
      writer.releaseLock();
    }
    await port.close().catch(() => undefined);
    this.port = undefined;
    this.emit("disconnect", new DisconnectEvent());
  }

  public isConnected(): boolean {
    return this.port !== undefined && this.writer !== undefined && this.reader !== undefined;
  }

  public async sendRaw(data: Uint8Array, force?: boolean): Promise<void> {
    const send = async () => {
      const writer = this.writer;
      if (!this.isConnected() || !writer) throw new Error("Printer is not connected");
      await new Promise((r) => setTimeout(r, this.packetIntervalMs));
      await writer.write(data);
    };
    if (force) await send();
    else await this.mutex.runExclusive(send);
  }

  public override getType() {
    return "serial" as const;
  }
}

/** Port source for the browser: reuse a previously granted NIIMBOT port, else ask the user. */
export function browserPortSource(): PortSource {
  return async () => {
    if (!("serial" in navigator)) {
      throw new Error("This browser has no Web Serial support. Use Microsoft Edge or Google Chrome.");
    }
    const serial = navigator.serial;
    const granted = (await serial.getPorts()).filter((p) => p.getInfo().usbVendorId === NIIMBOT_USB_VENDOR_ID);
    if (granted.length === 1) return granted[0] as unknown as SerialPortLike;
    const port = await serial.requestPort({ filters: [{ usbVendorId: NIIMBOT_USB_VENDOR_ID }] });
    return port as unknown as SerialPortLike;
  };
}
