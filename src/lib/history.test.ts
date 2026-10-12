import { describe, expect, it } from "vitest";
import {
  COALESCE_MS,
  commit,
  createHistory,
  HISTORY_LIMIT,
  redo,
  seal,
  undo,
} from "./history";

describe("history", () => {
  it("undoes and redoes steps; a new change clears redo", () => {
    let h = createHistory(0);
    h = commit(h, 1, undefined, 0);
    h = commit(h, 2, undefined, 10);
    h = undo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
    h = undo(undo(h));
    expect(h.present).toBe(0);
    expect(undo(h)).toBe(h); // nothing more to undo
    h = commit(h, 5, undefined, 20);
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it("coalesces rapid changes with the same key into one step", () => {
    let h = createHistory("");
    h = commit(h, "a", "type", 0);
    h = commit(h, "ab", "type", 100);
    h = commit(h, "abc", "type", 200);
    expect(undo(h).present).toBe("");
    h = commit(h, "abcd", "type", 200 + COALESCE_MS + 1);
    expect(undo(h).present).toBe("abc");
    h = commit(h, "x", "other", 200 + COALESCE_MS + 2);
    expect(undo(h).present).toBe("abcd");
  });

  it("ignores no-ops and caps the history length", () => {
    let h = createHistory(0);
    expect(commit(h, 0, undefined, 0)).toBe(h);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++)
      h = commit(h, i, undefined, i * 10_000);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });

  it("after undo, the next keyed change starts a new step", () => {
    let h = createHistory("");
    h = commit(h, "a", "type", 0);
    h = undo(h);
    h = commit(h, "b", "type", 10);
    expect(undo(h).present).toBe("");
  });
});

describe("seal", () => {
  it("ends coalescing so the next keyed change is a new undo step", () => {
    let h = createHistory(0);
    h = commit(h, 1, "drag:a", 0);
    h = seal(h);
    h = commit(h, 2, "drag:a", 10);
    expect(undo(h).present).toBe(1);
  });
});
