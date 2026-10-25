import { and, asc, desc, eq, getColumns, inArray, lte, max } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { inTransaction, type TDatabase, type TDb, type TTransaction } from "./db/client.ts";
import { nowIso, ulid } from "./db/helpers.ts";
import {
  tChangeset,
  tRowVersion,
  trackedTables,
  type TChangesetS,
  type TrackedTableName,
  type TRowVersionS,
} from "./db/schema/index.ts";
import type { Actor } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { emitChange } from "./events.ts";
import { withWriteLock } from "./lock.ts";

type Tables = typeof trackedTables;
type Row<N extends TrackedTableName> = Tables[N]["$inferSelect"];
type SystemKeys = "id" | "libraryId" | "version" | "changesetId" | "createdAt" | "updatedAt";
export type InsertValues<N extends TrackedTableName> = Omit<
  Tables[N]["$inferInsert"],
  SystemKeys
> & {
  id?: string;
};
export type UpdateValues<N extends TrackedTableName> = Partial<Omit<Row<N>, SystemKeys>>;

export interface ChangeContext {
  actor: Actor;
  action: string;
  libraryId: string | null;
  jobId?: string | null;
  sessionId?: string | null;
  reviewItemId?: string | null;
  note?: string;
  revertOf?: string | null;
}

type Plain = Record<string, unknown>;

function tableOf(name: TrackedTableName): SQLiteTable {
  return trackedTables[name] as unknown as SQLiteTable;
}

function idColumn(name: TrackedTableName): SQLiteColumn {
  return (getColumns(tableOf(name)) as Record<string, SQLiteColumn>)["id"] as SQLiteColumn;
}

const ID_PREFIX: Record<TrackedTableName, string> = {
  libraries: "lib",
  settings: "set",
  trusted_sources: "trs",
  sources: "src",
  source_units: "su",
  media_assets: "med",
  coverage_entries: "cov",
  topics: "top",
  subtopics: "sub",
  concepts: "con",
  knowledge_items: "ki",
  evidence: "evi",
  media_links: "mlk",
  relationships: "rel",
  learning_objectives: "lo",
  objective_mappings: "lom",
  review_items: "rev",
  review_item_targets: "rvt",
  review_messages: "rvm",
  approvals: "apr",
  card_plans: "cpl",
  card_plan_rows: "cpr",
  cards: "card",
  occlusion_masks: "occ",
  session_summaries: "ssum",
};

export function newId(table: TrackedTableName) {
  return ulid(ID_PREFIX[table]);
}

export class StaleVersionError extends DomainError {
  constructor(
    readonly table: TrackedTableName,
    readonly rowId: string,
    readonly expected: number,
    readonly current: Plain | null,
  ) {
    super(
      "stale_version",
      `${table} ${rowId} is at version ${typeof current?.["version"] === "number" ? current["version"] : "deleted"}, not ${expected}. Re-read it and retry.`,
    );
  }
}

/** Collects the writes of one changeset. Every write records a row version. */
export class Changes {
  readonly touched = new Set<TrackedTableName>();
  private count = 0;

  constructor(
    readonly tx: TTransaction,
    readonly changeset: TChangesetS,
  ) {}

  get writes() {
    return this.count;
  }

  async get<N extends TrackedTableName>(table: N, id: string): Promise<Row<N> | undefined> {
    const rows = (await this.tx
      .select()
      .from(tableOf(table))
      .where(eq(idColumn(table), id))
      .limit(1)) as Plain[];
    return rows[0] as Row<N> | undefined;
  }

  async insert<N extends TrackedTableName>(
    table: N,
    values: InsertValues<N>,
    libraryId?: string | null,
  ): Promise<Row<N>> {
    const now = nowIso();
    const row: Plain = {
      ...values,
      id: values.id ?? newId(table),
      libraryId: libraryId === undefined ? this.changeset.libraryId : libraryId,
      version: 1,
      changesetId: this.changeset.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.tx.insert(tableOf(table)).values(row);
    const stored = (await this.get(table, row["id"] as string)) as Plain;
    await this.record(table, stored["id"] as string, 1, "insert", stored, stored["libraryId"]);
    return stored as Row<N>;
  }

  async update<N extends TrackedTableName>(
    table: N,
    id: string,
    patch: UpdateValues<N>,
    expectedVersion?: number,
  ): Promise<Row<N>> {
    const current = (await this.get(table, id)) as Plain | undefined;
    if (!current) throw new DomainError("not_found", `${table} ${id} does not exist.`);
    const version = current["version"] as number;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw new StaleVersionError(table, id, expectedVersion, current);
    }
    const next: Plain = {
      ...patch,
      version: version + 1,
      changesetId: this.changeset.id,
      updatedAt: nowIso(),
    };
    await this.tx
      .update(tableOf(table))
      .set(next)
      .where(eq(idColumn(table), id));
    const stored = (await this.get(table, id)) as Plain;
    await this.record(table, id, version + 1, "update", stored, current["libraryId"]);
    return stored as Row<N>;
  }

  async remove(table: TrackedTableName, id: string, expectedVersion?: number): Promise<void> {
    const current = (await this.get(table, id)) as Plain | undefined;
    if (!current) return;
    const version = current["version"] as number;
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw new StaleVersionError(table, id, expectedVersion, current);
    }
    await this.tx.delete(tableOf(table)).where(eq(idColumn(table), id));
    await this.record(table, id, version + 1, "delete", null, current["libraryId"]);
  }

  /** Writes a full row state (used by revert and restore). `null` deletes the row. */
  async putState(table: TrackedTableName, id: string, state: Plain | null): Promise<void> {
    const current = (await this.get(table, id)) as Plain | undefined;
    const version = await this.latestVersion(table, id);
    if (state === null) {
      if (!current) return;
      await this.tx.delete(tableOf(table)).where(eq(idColumn(table), id));
      await this.record(table, id, version + 1, "delete", null, current["libraryId"]);
      return;
    }
    const row: Plain = {
      ...state,
      version: version + 1,
      changesetId: this.changeset.id,
      updatedAt: nowIso(),
    };
    if (current) {
      await this.tx
        .update(tableOf(table))
        .set(row)
        .where(eq(idColumn(table), id));
    } else {
      await this.tx.insert(tableOf(table)).values(row);
    }
    const stored = (await this.get(table, id)) as Plain;
    await this.record(
      table,
      id,
      version + 1,
      current ? "update" : "insert",
      stored,
      stored["libraryId"],
    );
  }

  private async latestVersion(table: TrackedTableName, id: string): Promise<number> {
    const [row] = await this.tx
      .select({ v: max(tRowVersion.version) })
      .from(tRowVersion)
      .where(and(eq(tRowVersion.tableName, table), eq(tRowVersion.rowId, id)));
    return row?.v ?? 0;
  }

  private async record(
    table: TrackedTableName,
    rowId: string,
    version: number,
    op: TRowVersionS["op"],
    data: Plain | null,
    libraryId: unknown,
  ) {
    this.count++;
    this.touched.add(table);
    await this.tx.insert(tRowVersion).values({
      changesetSeq: this.changeset.seq,
      changesetId: this.changeset.id,
      libraryId: typeof libraryId === "string" ? libraryId : null,
      tableName: table,
      rowId,
      version,
      op,
      data,
    });
  }
}

/**
 * Runs `fn` in one transaction as one changeset. Changesets with no writes are discarded.
 * Writes are serialised process-wide because node:sqlite has a single connection.
 */
export async function change<T>(
  db: TDatabase,
  ctx: ChangeContext,
  fn: (c: Changes) => Promise<T>,
): Promise<{ result: T; changesetId: string | null }> {
  const outcome = await withWriteLock(() =>
    inTransaction(db, async (tx) => {
      const [changeset] = await tx
        .insert(tChangeset)
        .values({
          id: ulid("chg"),
          libraryId: ctx.libraryId,
          actor: ctx.actor,
          action: ctx.action,
          jobId: ctx.jobId ?? null,
          sessionId: ctx.sessionId ?? null,
          reviewItemId: ctx.reviewItemId ?? null,
          note: ctx.note ?? "",
          revertOf: ctx.revertOf ?? null,
        })
        .returning();
      if (!changeset) throw new Error("Failed to create changeset");
      const changes = new Changes(tx, changeset);
      const result = await fn(changes);
      if (changes.writes === 0) {
        await tx.delete(tChangeset).where(eq(tChangeset.seq, changeset.seq));
        return { result, changesetId: null, touched: changes.touched };
      }
      return { result, changesetId: changeset.id, touched: changes.touched };
    }),
  );
  if (outcome.changesetId) {
    emitChange({
      libraryId: ctx.libraryId,
      tables: [...outcome.touched],
      changesetId: outcome.changesetId,
    });
  }
  return { result: outcome.result, changesetId: outcome.changesetId };
}

export interface RevertConflict {
  table: TrackedTableName;
  rowId: string;
  expectedVersion: number;
  currentVersion: number;
}

export class RevertConflictError extends DomainError {
  constructor(readonly conflicts: RevertConflict[]) {
    super(
      "revert_conflict",
      `Can't revert: ${conflicts.length} row(s) changed since. ${conflicts
        .slice(0, 5)
        .map((c) => `${c.table} ${c.rowId}`)
        .join(", ")}`,
    );
  }
}

async function versionsOf(db: TDb, changesetIds: string[]): Promise<TRowVersionS[]> {
  if (changesetIds.length === 0) return [];
  return db
    .select()
    .from(tRowVersion)
    .where(inArray(tRowVersion.changesetId, changesetIds))
    .orderBy(desc(tRowVersion.id));
}

async function stateBefore(
  db: TDb,
  table: string,
  rowId: string,
  version: number,
): Promise<Plain | null> {
  const [prev] = await db
    .select()
    .from(tRowVersion)
    .where(
      and(
        eq(tRowVersion.tableName, table),
        eq(tRowVersion.rowId, rowId),
        lte(tRowVersion.version, version - 1),
      ),
    )
    .orderBy(desc(tRowVersion.version))
    .limit(1);
  return prev?.data ?? null;
}

async function currentVersion(db: TDb, table: string, rowId: string): Promise<number> {
  const [row] = await db
    .select({ v: max(tRowVersion.version) })
    .from(tRowVersion)
    .where(and(eq(tRowVersion.tableName, table), eq(tRowVersion.rowId, rowId)));
  return row?.v ?? 0;
}

/**
 * Reverts changesets (newest first) as one new changeset. Refuses when any touched row
 * has been changed by a changeset outside the set.
 */
export async function revertChangesets(
  db: TDatabase,
  changesetIds: string[],
  ctx: Omit<ChangeContext, "revertOf"> & { revertOf?: string | null },
) {
  const versions = await versionsOf(db, changesetIds);
  if (versions.length === 0) throw new DomainError("not_found", "Nothing to revert.");

  // For each row, the earliest version touched by the set and the latest one it produced.
  const rows = new Map<
    string,
    { table: TrackedTableName; rowId: string; earliest: number; latest: number }
  >();
  for (const v of versions) {
    const key = `${v.tableName}:${v.rowId}`;
    const entry = rows.get(key);
    if (!entry) {
      rows.set(key, {
        table: v.tableName as TrackedTableName,
        rowId: v.rowId,
        earliest: v.version,
        latest: v.version,
      });
    } else {
      entry.earliest = Math.min(entry.earliest, v.version);
      entry.latest = Math.max(entry.latest, v.version);
    }
  }

  const conflicts: RevertConflict[] = [];
  for (const r of rows.values()) {
    const current = await currentVersion(db, r.table, r.rowId);
    if (current !== r.latest) {
      conflicts.push({
        table: r.table,
        rowId: r.rowId,
        expectedVersion: r.latest,
        currentVersion: current,
      });
    }
  }
  if (conflicts.length > 0) throw new RevertConflictError(conflicts);

  return change(db, { ...ctx, revertOf: ctx.revertOf ?? changesetIds[0] ?? null }, async (c) => {
    for (const r of rows.values()) {
      const target = await stateBefore(c.tx, r.table, r.rowId, r.earliest);
      await c.putState(r.table, r.rowId, target);
    }
    return rows.size;
  });
}

export async function revertJob(db: TDatabase, jobId: string, ctx: Omit<ChangeContext, "jobId">) {
  const sets = await db
    .select({ id: tChangeset.id })
    .from(tChangeset)
    .where(eq(tChangeset.jobId, jobId))
    .orderBy(desc(tChangeset.seq));
  return revertChangesets(
    db,
    sets.map((s) => s.id),
    { ...ctx, note: ctx.note ?? `Revert job ${jobId}` },
  );
}

/** State of every tracked row of a library as of a changeset sequence number. */
export async function libraryStateAt(
  db: TDb,
  libraryId: string,
  seq: number,
  tables?: TrackedTableName[],
): Promise<Map<TrackedTableName, Map<string, Plain>>> {
  const conditions = [eq(tRowVersion.libraryId, libraryId), lte(tRowVersion.changesetSeq, seq)];
  if (tables) conditions.push(inArray(tRowVersion.tableName, tables));
  const versions = await db
    .select()
    .from(tRowVersion)
    .where(and(...conditions))
    .orderBy(asc(tRowVersion.id));
  const state = new Map<TrackedTableName, Map<string, Plain>>();
  for (const v of versions) {
    const table = v.tableName as TrackedTableName;
    let rows = state.get(table);
    if (!rows) {
      rows = new Map();
      state.set(table, rows);
    }
    if (v.data) rows.set(v.rowId, v.data);
    else rows.delete(v.rowId);
  }
  return state;
}

export async function rowsAt<N extends TrackedTableName>(
  db: TDb,
  libraryId: string,
  seq: number,
  table: N,
): Promise<Row<N>[]> {
  const state = await libraryStateAt(db, libraryId, seq, [table]);
  return [...(state.get(table)?.values() ?? [])] as Row<N>[];
}

/** Rewrites the library to its state at `seq`, as one new changeset. */
export async function restoreLibraryTo(
  db: TDatabase,
  libraryId: string,
  seq: number,
  ctx: ChangeContext,
) {
  const target = await libraryStateAt(db, libraryId, seq);
  const latestSeq = await latestChangesetSeq(db);
  const now = await libraryStateAt(db, libraryId, latestSeq);
  return change(
    db,
    { ...ctx, libraryId, note: ctx.note ?? `Restore to changeset #${seq}` },
    async (c) => {
      let count = 0;
      const tables = new Set<TrackedTableName>([...target.keys(), ...now.keys()]);
      for (const table of tables) {
        const want = target.get(table) ?? new Map<string, Plain>();
        const have = now.get(table) ?? new Map<string, Plain>();
        for (const [id, row] of want) {
          const existing = have.get(id);
          if (!existing || existing["version"] !== row["version"]) {
            const { version: _v, changesetId: _c, updatedAt: _u, ...data } = row;
            await c.putState(table, id, data);
            count++;
          }
        }
        for (const id of have.keys()) {
          if (!want.has(id)) {
            await c.putState(table, id, null);
            count++;
          }
        }
      }
      return count;
    },
  );
}

export async function latestChangesetSeq(db: TDb): Promise<number> {
  const [row] = await db.select({ seq: max(tChangeset.seq) }).from(tChangeset);
  return row?.seq ?? 0;
}

export async function listChangesets(db: TDb, libraryId: string, limit = 100, beforeSeq?: number) {
  const conditions = [eq(tChangeset.libraryId, libraryId)];
  if (beforeSeq !== undefined) conditions.push(lte(tChangeset.seq, beforeSeq - 1));
  return db
    .select()
    .from(tChangeset)
    .where(and(...conditions))
    .orderBy(desc(tChangeset.seq))
    .limit(limit);
}

export interface RowDiff {
  table: string;
  rowId: string;
  op: TRowVersionS["op"];
  version: number;
  before: Plain | null;
  after: Plain | null;
}

export async function changesetDiff(db: TDb, changesetId: string): Promise<RowDiff[]> {
  const versions = await db
    .select()
    .from(tRowVersion)
    .where(eq(tRowVersion.changesetId, changesetId))
    .orderBy(asc(tRowVersion.id));
  const diffs: RowDiff[] = [];
  for (const v of versions) {
    diffs.push({
      table: v.tableName,
      rowId: v.rowId,
      op: v.op,
      version: v.version,
      before: await stateBefore(db, v.tableName, v.rowId, v.version),
      after: v.data,
    });
  }
  return diffs;
}
