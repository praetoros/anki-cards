import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { trackedCols } from "../helpers.ts";

export const tLibrary = sqliteTable("libraries", {
  ...trackedCols,
  name: text().notNull(),
  description: text().notNull().default(""),
});

/** `libraryId` is null for global settings. */
export const tSetting = sqliteTable(
  "settings",
  {
    ...trackedCols,
    libraryId: text(),
    key: text().notNull(),
    value: text({ mode: "json" }).$type<unknown>().notNull(),
  },
  (t) => [index("settings_library_key_idx").on(t.libraryId, t.key)],
);

/** `libraryId` is null for the global list. */
export const tTrustedSource = sqliteTable("trusted_sources", {
  ...trackedCols,
  libraryId: text(),
  domain: text().notNull(),
  note: text().notNull().default(""),
});

export type TLibraryS = typeof tLibrary.$inferSelect;
export type TSettingS = typeof tSetting.$inferSelect;
export type TTrustedSourceS = typeof tTrustedSource.$inferSelect;
