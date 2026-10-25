import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  CoverageOutcome,
  ExtractionStatus,
  MediaRelevance,
  Origin,
  UnitType,
} from "../../domain/enums.ts";
import { trackedCols } from "../helpers.ts";

export const tSource = sqliteTable(
  "sources",
  {
    ...trackedCols,
    displayId: text().notNull(),
    title: text().notNull(),
    fileName: text().notNull(),
    fileType: text().notNull(),
    sha256: text().notNull(),
    storagePath: text().notNull(),
    pageCount: integer().notNull().default(0),
    extractionStatus: text().$type<ExtractionStatus>().notNull(),
    limitations: text({ mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [index("sources_library_idx").on(t.libraryId)],
);

export interface UnitLocation {
  page?: number;
  slide?: number;
  label?: string;
}

export interface TextBlockRecord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export const tSourceUnit = sqliteTable(
  "source_units",
  {
    ...trackedCols,
    displayId: text().notNull(),
    sourceId: text().notNull(),
    ordinal: integer().notNull(),
    unitType: text().$type<UnitType>().notNull(),
    location: text({ mode: "json" }).$type<UnitLocation>().notNull(),
    text: text().notNull().default(""),
    textBlocks: text({ mode: "json" }).$type<TextBlockRecord[]>().notNull(),
    renderMediaId: text(),
    mediaIds: text({ mode: "json" }).$type<string[]>().notNull(),
    width: integer(),
    height: integer(),
  },
  (t) => [index("source_units_source_idx").on(t.sourceId)],
);

export interface MediaProvenance {
  sourceUnitId?: string;
  kind?: "embedded" | "render" | "frame" | "external" | "upload";
  renderDpi?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  externalUrl?: string;
  pageUrl?: string;
  creator?: string;
  licence?: string;
  attribution?: string;
  detail?: Record<string, string | number>;
}

export const tMediaAsset = sqliteTable(
  "media_assets",
  {
    ...trackedCols,
    displayId: text().notNull(),
    sha256: text().notNull(),
    storagePath: text().notNull(),
    mime: text().notNull(),
    width: integer(),
    height: integer(),
    origin: text().$type<Origin>().notNull(),
    sourceId: text(),
    provenance: text({ mode: "json" }).$type<MediaProvenance>().notNull(),
    relevance: text().$type<MediaRelevance>().notNull().default("uncertain"),
    description: text().notNull().default(""),
  },
  (t) => [index("media_assets_library_idx").on(t.libraryId)],
);

export const tCoverageEntry = sqliteTable(
  "coverage_entries",
  {
    ...trackedCols,
    sourceUnitId: text().notNull(),
    outcome: text().$type<CoverageOutcome>().notNull(),
    conceptIds: text({ mode: "json" }).$type<string[]>().notNull(),
    knowledgeItemIds: text({ mode: "json" }).$type<string[]>().notNull(),
    mediaIds: text({ mode: "json" }).$type<string[]>().notNull(),
    explanation: text().notNull().default(""),
  },
  (t) => [index("coverage_entries_unit_idx").on(t.sourceUnitId)],
);

export type TSourceS = typeof tSource.$inferSelect;
export type TSourceUnitS = typeof tSourceUnit.$inferSelect;
export type TMediaAssetS = typeof tMediaAsset.$inferSelect;
export type TCoverageEntryS = typeof tCoverageEntry.$inferSelect;
