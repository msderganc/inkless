/** Undo/redo history with coalescing of rapid edits (typing, dragging, sliders). */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Coalescing key and time of the last change. */
  lastKey?: string;
  lastAt: number;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastAt: 0 };
}

/**
 * Apply a change. Changes with the same `key` within COALESCE_MS replace the current step
 * instead of adding one (so a drag or a typed word is a single undo step). No-ops are ignored.
 */
export function commit<T>(
  h: History<T>,
  next: T,
  key: string | undefined,
  now: number,
): History<T> {
  if (Object.is(next, h.present)) return h;
  const merge =
    key !== undefined &&
    key === h.lastKey &&
    now - h.lastAt < COALESCE_MS &&
    h.past.length > 0;
  return {
    past: merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

/** End the current coalescing run so the next change starts a new undo step. */
export function seal<T>(h: History<T>): History<T> {
  return h.lastKey === undefined ? h : { ...h, lastKey: undefined };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
    lastAt: 0,
  };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
    lastAt: 0,
  };
}
