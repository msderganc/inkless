import { describe, expect, it } from "vitest";
import { flushPendingWork, onFlush } from "./flush";

describe("flushPendingWork (saving before an update reload or navigation)", () => {
  it("waits for every registered save, survives failures, and forgets unregistered ones", async () => {
    const done: string[] = [];
    const offA = onFlush(async () => {
      await new Promise((r) => setTimeout(r, 20));
      done.push("a");
    });
    const offB = onFlush(() => Promise.reject(new Error("disk full")));
    const offC = onFlush(async () => {
      done.push("c");
    });
    offC();
    await flushPendingWork();
    expect(done).toEqual(["a"]);
    offA();
    offB();
  });

  it("gives up after the timeout instead of blocking the reload", async () => {
    const off = onFlush(() => new Promise(() => undefined));
    const t0 = Date.now();
    await flushPendingWork(50);
    expect(Date.now() - t0).toBeLessThan(1000);
    off();
  });
});
