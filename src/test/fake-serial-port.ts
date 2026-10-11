import { type SerialPortLike } from "~/lib/printer/serial-client";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

/** "Feature not supported" reply, as NiimBlueLib's virtual client sends for unknown requests. */
const NOT_SUPPORTED = unhex("555500010100aaaa");

/** Parse `>> request` / `<< response` hex dump lines into a lookup table. */
export function parseDump(dump: string): Map<string, Uint8Array> {
  const table = new Map<string, Uint8Array>();
  let req: string | undefined;
  for (const line of dump.split(/\r?\n/)) {
    const m = /^\s*(>>|<<)\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2]!.replace(/\s+/g, "").toLowerCase();
    if (m[1] === ">>") req = value;
    else if (req) {
      table.set(req, unhex(value));
      req = undefined;
    }
  }
  return table;
}

/**
 * In-memory Web Serial port that answers requests from a recorded dump. It enforces the real
 * API's rules that matter for lifecycle bugs: `open()` twice fails, and `close()` fails while a
 * stream is locked.
 */
export class FakeSerialPort extends EventTarget implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  opens = 0;
  closes = 0;
  /** Live listener count per event type. */
  readonly listeners = new Map<string, number>();
  /** Request hex strings in order. */
  readonly sent: string[] = [];
  private controller?: ReadableStreamDefaultController<Uint8Array>;
  /** When set, responses are not delivered (simulates a hung printer). */
  silent = false;

  constructor(private readonly table: Map<string, Uint8Array>) {
    super();
  }

  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, o?: AddEventListenerOptions | boolean) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, cb, o);
  }

  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, o?: EventListenerOptions | boolean) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1);
    super.removeEventListener(type, cb, o);
  }

  get isOpen() {
    return this.readable !== null;
  }

  async open(): Promise<void> {
    if (this.isOpen) throw new DOMException("The port is already open.", "InvalidStateError");
    this.opens++;
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const key = hex(chunk);
        this.sent.push(key);
        if (this.silent) return;
        const reply = this.respond(chunk, key);
        if (!reply) return;
        setTimeout(() => {
          try {
            this.controller?.enqueue(reply);
          } catch {
            // stream already closed
          }
        }, 1);
      },
    });
  }

  /** Reply for one request packet; `undefined` = no reply (one-way packets). */
  protected respond(_packet: Uint8Array, key: string): Uint8Array | undefined {
    return this.table.get(key) ?? NOT_SUPPORTED;
  }

  async close(): Promise<void> {
    if (!this.isOpen) throw new DOMException("The port is already closed.", "InvalidStateError");
    if (this.readable!.locked || this.writable!.locked) {
      throw new TypeError("Cannot close a port with locked streams");
    }
    this.closes++;
    this.readable = null;
    this.writable = null;
    this.controller = undefined;
  }

  getInfo() {
    return { usbVendorId: 0x3513, usbProductId: 0x0002 };
  }

  /** Simulate unplugging the cable. */
  unplug() {
    try {
      this.controller?.error(new DOMException("The device has been lost.", "NetworkError"));
    } catch {
      // ignore
    }
    this.dispatchEvent(new Event("disconnect"));
  }
}
