/**
 * Work that must be saved before the page goes away (app update reload, navigation): the
 * editor registers its autosave here, and whoever is about to reload awaits flushPendingWork().
 */
const flushers = new Set<() => Promise<unknown>>();

export function onFlush(fn: () => Promise<unknown>): () => void {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

/** Run every registered save; never rejects, and gives up after `timeoutMs`. */
export async function flushPendingWork(timeoutMs = 2000): Promise<void> {
  const all = Promise.allSettled([...flushers].map((f) => f()));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}
