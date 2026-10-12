"use client";

import { useCallback, useState } from "react";
import { type Design } from "~/lib/design";
import { commit, createHistory, type History, redo, undo } from "~/lib/history";

export type DesignUpdate = Design | ((d: Design) => Design);

/**
 * Design state with undo/redo. `key` coalesces rapid edits of the same thing (typing in one
 * box, one drag, one slider) into a single undo step.
 */
export function useDesignHistory(initial: () => Design) {
  const [h, setH] = useState<History<Design>>(() => createHistory(initial()));
  const update = useCallback((next: DesignUpdate, key?: string) => {
    const now = Date.now();
    setH((cur) =>
      commit(
        cur,
        typeof next === "function" ? next(cur.present) : next,
        key,
        now,
      ),
    );
  }, []);
  return {
    design: h.present,
    update,
    undo: useCallback(() => setH(undo), []),
    redo: useCallback(() => setH(redo), []),
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
