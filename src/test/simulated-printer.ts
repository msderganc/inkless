import { B21S_V40_28 } from "./b21s-dump";
import { FakeSerialPort, parseDump } from "./fake-serial-port";

function packet(cmd: number, data: number[]): Uint8Array {
  let sum = cmd ^ data.length;
  for (const d of data) sum ^= d;
  return new Uint8Array([0x55, 0x55, cmd, data.length, ...data, sum, 0xaa, 0xaa]);
}

/** Request → response command ids for the D110-style print sequence (NiimBlueLib commands.ts). */
const ACK: Record<number, number> = {
  0x21: 0x31, // SetDensity
  0x23: 0x33, // SetLabelType
  0x01: 0x02, // PrintStart
  0x20: 0x30, // PrintClear
  0x03: 0x04, // PageStart
  0x13: 0x14, // SetPageSize
  0x15: 0x16, // PrintQuantity
  0xe3: 0xe4, // PageEnd
  0xf3: 0xf4, // PrintEnd
};
const ONE_WAY = new Set([0x83, 0x84, 0x85]); // bitmap rows, empty rows

/**
 * A simulated B21S: identifies itself from the recorded dump and accepts the D110 print
 * sequence, counting pages and image rows like the real printer reports them.
 */
export class SimulatedB21S extends FakeSerialPort {
  density?: number;
  labelType?: number;
  quantity = 1;
  pagesPrinted = 0;
  pageSizes: { rows: number; cols: number }[] = [];
  /** Bitmap/empty-row packets received. */
  imagePackets = 0;
  ended = 0;
  /** When true, pages never complete (a jammed or stalled feed that still answers status polls). */
  stalled = false;
  /** Status code to report in print status (e.g. 1 = lid open). */
  statusError = 0;

  constructor() {
    super(parseDump(B21S_V40_28));
  }

  protected override respond(p: Uint8Array, key: string): Uint8Array | undefined {
    const known = super.respond(p, key);
    if (known && known[2] !== 0x00) return known;
    const cmd = p[2]!;
    const data = [...p.subarray(4, 4 + p[3]!)];
    if (ONE_WAY.has(cmd)) {
      this.imagePackets++;
      return undefined;
    }
    switch (cmd) {
      case 0x21:
        this.density = data[0];
        break;
      case 0x23:
        this.labelType = data[0];
        break;
      case 0x13:
        this.pageSizes.push({ rows: (data[0]! << 8) | data[1]!, cols: (data[2]! << 8) | data[3]! });
        break;
      case 0x15:
        this.quantity = (data[0]! << 8) | data[1]!;
        break;
      case 0xe3:
        if (!this.stalled) this.pagesPrinted += this.quantity;
        break;
      case 0xf3:
        this.ended++;
        break;
      case 0xa3: {
        const status = [this.pagesPrinted >> 8, this.pagesPrinted & 0xff, 100, 100];
        // 10-byte form: page(2) printProgress feedProgress ?(2) error ...(3) — parsePrintStatusResponse.
        return packet(0xb3, this.statusError ? [...status, 0, 0, this.statusError, 0, 0, 0] : status);
      }
    }
    const ack = ACK[cmd];
    return ack === undefined ? known : packet(ack, [1]);
  }
}
