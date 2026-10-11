import { afterEach, describe, expect, it } from "vitest";
import { B21S_V40_28 } from "~/test/b21s-dump";
import { FakeSerialPort, parseDump } from "~/test/fake-serial-port";
import { B21SerialClient } from "./serial-client";

const table = parseDump(B21S_V40_28);
let client: B21SerialClient | undefined;

function setup() {
  const port = new FakeSerialPort(table);
  client = new B21SerialClient(async () => port);
  client.setHeartbeatAutoStart(false);
  client.setPacketInterval(0);
  return { port, client };
}

afterEach(async () => {
  await client?.disconnect();
});

describe("B21SerialClient", () => {
  it("identifies the recorded B21S", async () => {
    const { client } = setup();
    await client.connect();
    const info = client.getPrinterInfo();
    expect(info.modelId).toBe(777);
    expect(info.softwareVersion).toMatch(/40\.28/);
    expect(info.serial).toBe("G626070087");
    expect(client.getModelMetadata()?.model).toBe("B21S");
    expect(client.getPrintTaskType()).toBe("D110");
    const hb = await client.protocol.heartbeat();
    expect(hb.lidClosed).toBe(true);
  });

  it("reads label RFID info (barcode, counts) without size or shape (V1)", async () => {
    const { client } = setup();
    await client.connect();
    const rfid = client.getRfidInfo().labelRfidInfo;
    expect(rfid?.tagPresent).toBe(true);
    expect(rfid?.barCode).toMatch(/^\d+$/);
    expect(rfid && "widthMm" in rfid).toBe(false);
  });

  it("releases everything on disconnect", async () => {
    const { port, client } = setup();
    await client.connect();
    expect(port.listeners.get("disconnect")).toBe(1);
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(port.isOpen).toBe(false);
    expect(port.closes).toBe(1);
    expect(port.listeners.get("disconnect")).toBe(0);
  });

  it("emits disconnect once and tolerates repeated disconnects", async () => {
    const { client } = setup();
    let events = 0;
    client.on("disconnect", () => events++);
    await client.connect();
    await Promise.all([client.disconnect(), client.disconnect()]);
    await client.disconnect();
    expect(events).toBe(1);
  });

  it("survives 100 connect/disconnect cycles without accumulating listeners", async () => {
    const { port, client } = setup();
    for (let i = 0; i < 100; i++) {
      await client.connect();
      await client.disconnect();
    }
    expect(port.opens).toBe(100);
    expect(port.closes).toBe(100);
    expect(port.listeners.get("disconnect")).toBe(0);
    expect(client.listenerCount("packetreceived")).toBe(0);
  }, 60_000);

  it("reconnecting while connected closes the old session first", async () => {
    const { port, client } = setup();
    await client.connect();
    await client.connect();
    expect(port.opens).toBe(2);
    expect(port.closes).toBe(1);
    expect(port.listeners.get("disconnect")).toBe(1);
  });

  it("cleans up when the cable is unplugged", async () => {
    const { port, client } = setup();
    const gone = new Promise<void>((r) => client.once("disconnect", () => r()));
    await client.connect();
    port.unplug();
    await gone;
    expect(client.isConnected()).toBe(false);
    expect(port.listeners.get("disconnect")).toBe(0);
  });

  it("closes the port when negotiation fails", async () => {
    const { port, client } = setup();
    port.silent = true;
    await expect(client.connect()).rejects.toThrow();
    expect(port.isOpen).toBe(false);
    expect(port.listeners.get("disconnect")).toBe(0);
    expect(client.isConnected()).toBe(false);
  }, 20_000);

  it("refuses to send when disconnected", async () => {
    const { client } = setup();
    await expect(client.sendRaw(new Uint8Array([1]))).rejects.toThrow(/not connected/);
  });
});
