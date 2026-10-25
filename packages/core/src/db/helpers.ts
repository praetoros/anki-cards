import { randomBytes } from "node:crypto";

import { integer, text } from "drizzle-orm/sqlite-core";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(prefix?: string): string {
  let time = Date.now();
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = ENCODING[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const random = randomBytes(16);
  let randomPart = "";
  for (let i = 0; i < 16; i++) randomPart += ENCODING[(random[i] ?? 0) % 32];
  const id = timePart + randomPart;
  return prefix ? `${prefix}_${id.toLowerCase()}` : id.toLowerCase();
}

export const nowIso = () => new Date().toISOString();

/** Columns every tracked (history-backed) table has. Getters return fresh builders per table. */
export const trackedCols = {
  get id() {
    return text().primaryKey();
  },
  get libraryId() {
    return text().notNull();
  },
  get version() {
    return integer().notNull();
  },
  get changesetId() {
    return text().notNull();
  },
  get createdAt() {
    return text().notNull();
  },
  get updatedAt() {
    return text().notNull();
  },
};

export const timestampCols = {
  get createdAt() {
    return text()
      .notNull()
      .$defaultFn(() => nowIso());
  },
};
