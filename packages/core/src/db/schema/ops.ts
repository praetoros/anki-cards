import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  Actor,
  Gate,
  JobKind,
  JobStatus,
  JobTrigger,
  ProviderId,
  SessionKind,
  SessionStatus,
} from "../../domain/enums.ts";
import { timestampCols, trackedCols } from "../helpers.ts";

export const tChangeset = sqliteTable(
  "changesets",
  {
    seq: integer().primaryKey({ autoIncrement: true }),
    id: text().notNull().unique(),
    libraryId: text(),
    actor: text().$type<Actor>().notNull(),
    action: text().notNull(),
    jobId: text(),
    sessionId: text(),
    reviewItemId: text(),
    note: text().notNull().default(""),
    revertOf: text(),
    ...timestampCols,
  },
  (t) => [index("changesets_library_idx").on(t.libraryId), index("changesets_job_idx").on(t.jobId)],
);

export const tRowVersion = sqliteTable(
  "row_versions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    changesetSeq: integer().notNull(),
    changesetId: text().notNull(),
    libraryId: text(),
    tableName: text().notNull(),
    rowId: text().notNull(),
    version: integer().notNull(),
    op: text().$type<"insert" | "update" | "delete">().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown> | null>(),
  },
  (t) => [
    index("row_versions_row_idx").on(t.tableName, t.rowId),
    index("row_versions_changeset_idx").on(t.changesetId),
    index("row_versions_library_seq_idx").on(t.libraryId, t.changesetSeq),
  ],
);

export const tSnapshot = sqliteTable("snapshots", {
  id: text().primaryKey(),
  libraryId: text().notNull(),
  gate: text().$type<Gate>().notNull(),
  topicId: text(),
  name: text().notNull(),
  changesetSeq: integer().notNull(),
  ...timestampCols,
});

export interface SessionScope {
  kind: "library" | "topics";
  topicIds: string[];
}

export const tSession = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    libraryId: text().notNull(),
    kind: text().$type<SessionKind>().notNull(),
    title: text().notNull(),
    scope: text({ mode: "json" }).$type<SessionScope>().notNull(),
    provider: text().$type<ProviderId>().notNull(),
    model: text(),
    effort: text(),
    cliSessionId: text(),
    status: text().$type<SessionStatus>().notNull(),
    contextTokens: integer().notNull().default(0),
    jobCount: integer().notNull().default(0),
    parentSessionId: text(),
    ...timestampCols,
    updatedAt: text().notNull(),
  },
  (t) => [index("sessions_library_idx").on(t.libraryId)],
);

export const tSessionToken = sqliteTable("session_tokens", {
  tokenHash: text().primaryKey(),
  sessionId: text().notNull(),
  valid: integer({ mode: "boolean" }).notNull(),
  ...timestampCols,
});

export const tSessionSummary = sqliteTable(
  "session_summaries",
  {
    ...trackedCols,
    sessionId: text().notNull(),
    body: text().notNull(),
    edited: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("session_summaries_session_idx").on(t.sessionId)],
);

export interface JobUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd?: number;
  durationMs?: number;
}

export const tJob = sqliteTable(
  "jobs",
  {
    id: text().primaryKey(),
    libraryId: text().notNull(),
    sessionId: text().notNull(),
    kind: text().$type<JobKind>().notNull(),
    trigger: text().$type<JobTrigger>().notNull(),
    status: text().$type<JobStatus>().notNull(),
    prompt: text().notNull(),
    provider: text().$type<ProviderId>().notNull(),
    model: text(),
    effort: text(),
    attempt: integer().notNull().default(0),
    resumeAfter: text(),
    error: text(),
    exitCode: integer(),
    usage: text({ mode: "json" }).$type<JobUsage | null>(),
    reviewItemIds: text({ mode: "json" }).$type<string[]>().notNull(),
    runDir: text(),
    ...timestampCols,
    startedAt: text(),
    finishedAt: text(),
  },
  (t) => [index("jobs_session_idx").on(t.sessionId), index("jobs_status_idx").on(t.status)],
);

export const tJobEvent = sqliteTable(
  "job_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    jobId: text().notNull(),
    type: text().notNull(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ...timestampCols,
  },
  (t) => [index("job_events_job_idx").on(t.jobId)],
);

export interface ExportCounts {
  added: number;
  changed: number;
  retired: number;
  unchanged: number;
  total: number;
}

export const tExport = sqliteTable("exports", {
  id: text().primaryKey(),
  libraryId: text().notNull(),
  snapshotId: text(),
  filePath: text().notNull(),
  copiedTo: text(),
  counts: text({ mode: "json" }).$type<ExportCounts>().notNull(),
  cardGuids: text({ mode: "json" }).$type<Record<string, string>>().notNull(),
  ...timestampCols,
});

export const tBackup = sqliteTable("backups", {
  id: text().primaryKey(),
  path: text().notNull(),
  reason: text().notNull(),
  ...timestampCols,
});

export const tProviderCheck = sqliteTable("provider_checks", {
  provider: text().$type<ProviderId>().primaryKey(),
  path: text(),
  version: text(),
  loggedIn: integer({ mode: "boolean" }).notNull().default(false),
  ok: integer({ mode: "boolean" }).notNull().default(false),
  message: text().notNull().default(""),
  testOk: integer({ mode: "boolean" }),
  testMessage: text(),
  testedAt: text(),
  checkedAt: text().notNull(),
});

export const tDisplayCounter = sqliteTable(
  "display_counters",
  {
    libraryId: text().notNull(),
    prefix: text().notNull(),
    next: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.libraryId, t.prefix] })],
);

export type TChangesetS = typeof tChangeset.$inferSelect;
export type TRowVersionS = typeof tRowVersion.$inferSelect;
export type TSnapshotS = typeof tSnapshot.$inferSelect;
export type TSessionS = typeof tSession.$inferSelect;
export type TSessionSummaryS = typeof tSessionSummary.$inferSelect;
export type TJobS = typeof tJob.$inferSelect;
export type TJobEventS = typeof tJobEvent.$inferSelect;
export type TExportS = typeof tExport.$inferSelect;
export type TBackupS = typeof tBackup.$inferSelect;
export type TProviderCheckS = typeof tProviderCheck.$inferSelect;
