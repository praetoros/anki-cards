const key = Symbol.for("anki-cards.write-lock");
const store = globalThis as unknown as Record<symbol, { tail: Promise<unknown> } | undefined>;
const lock = (store[key] ??= { tail: Promise.resolve() });

/** Serialises every database write in the process (one node:sqlite connection, one writer). */
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.tail.then(fn, fn);
  lock.tail = run.catch(() => undefined);
  return run;
}
