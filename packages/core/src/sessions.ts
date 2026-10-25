import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { TDb } from "./db/client.ts";
import { nowIso, ulid } from "./db/helpers.ts";
import {
  tJob,
  tSession,
  tSessionToken,
  tSubtopic,
  tConcept,
  tKnowledgeItem,
  type SessionScope,
  type TSessionS,
} from "./db/schema/index.ts";
import type { ProviderId, SessionKind } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { emitChange } from "./events.ts";
import { withWriteLock } from "./lock.ts";

export const CONTEXT_WINDOW: Record<ProviderId, number> = { claude: 200_000, codex: 272_000 };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(
  db: TDb,
  input: {
    libraryId: string;
    kind: SessionKind;
    title: string;
    scope: SessionScope;
    provider: ProviderId;
    model?: string | null;
    effort?: string | null;
    parentSessionId?: string | null;
  },
): Promise<TSessionS> {
  const session = await withWriteLock(async () => {
    const [row] = await db
      .insert(tSession)
      .values({
        id: ulid("ses"),
        libraryId: input.libraryId,
        kind: input.kind,
        title: input.title,
        scope: input.scope,
        provider: input.provider,
        model: input.model ?? null,
        effort: input.effort ?? null,
        status: "idle",
        parentSessionId: input.parentSessionId ?? null,
        updatedAt: nowIso(),
      })
      .returning();
    if (!row) throw new Error("Failed to create session");
    return row;
  });
  emitChange({ libraryId: input.libraryId, tables: ["sessions"], changesetId: null });
  return session;
}

export async function getSession(db: TDb, id: string) {
  const [row] = await db.select().from(tSession).where(eq(tSession.id, id)).limit(1);
  if (!row) throw new DomainError("not_found", `Session ${id} not found.`);
  return row;
}

export async function listSessions(db: TDb, libraryId: string, includeArchived = false) {
  return db
    .select()
    .from(tSession)
    .where(
      includeArchived
        ? eq(tSession.libraryId, libraryId)
        : and(eq(tSession.libraryId, libraryId), ne(tSession.status, "archived")),
    )
    .orderBy(desc(tSession.updatedAt));
}

export async function updateSession(
  db: TDb,
  id: string,
  patch: Partial<Omit<TSessionS, "id" | "libraryId" | "createdAt">>,
) {
  const row = await withWriteLock(async () => {
    const [r] = await db
      .update(tSession)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(tSession.id, id))
      .returning();
    return r;
  });
  if (row) emitChange({ libraryId: row.libraryId, tables: ["sessions"], changesetId: null });
  return row;
}

export async function archiveSession(db: TDb, id: string) {
  await revokeTokens(db, id);
  return updateSession(db, id, { status: "archived" });
}

/** Issues a fresh bearer token for a session, revoking earlier ones. Returns the plain token. */
export async function issueSessionToken(db: TDb, sessionId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await withWriteLock(async () => {
    await db
      .update(tSessionToken)
      .set({ valid: false })
      .where(eq(tSessionToken.sessionId, sessionId));
    await db.insert(tSessionToken).values({ tokenHash: hashToken(token), sessionId, valid: true });
  });
  return token;
}

export async function revokeTokens(db: TDb, sessionId: string) {
  await withWriteLock(() =>
    db.update(tSessionToken).set({ valid: false }).where(eq(tSessionToken.sessionId, sessionId)),
  );
}

/** The session and its running job for a bearer token, or undefined when the token is not valid. */
export async function sessionForToken(db: TDb, token: string) {
  const [row] = await db
    .select()
    .from(tSessionToken)
    .where(and(eq(tSessionToken.tokenHash, hashToken(token)), eq(tSessionToken.valid, true)))
    .limit(1);
  if (!row) return undefined;
  const session = await getSession(db, row.sessionId);
  if (session.status === "archived") return undefined;
  const [job] = await db
    .select()
    .from(tJob)
    .where(and(eq(tJob.sessionId, session.id), inArray(tJob.status, ["running"])))
    .orderBy(desc(tJob.createdAt))
    .limit(1);
  return { session, job };
}

/** Topic a tracked row belongs to, for scope checks. */
export async function topicOf(
  db: TDb,
  target: {
    topicId?: string | null;
    subtopicId?: string | null;
    conceptId?: string | null;
    knowledgeItemId?: string | null;
  },
): Promise<string | null> {
  if (target.topicId) return target.topicId;
  let conceptId = target.conceptId ?? null;
  if (!conceptId && target.knowledgeItemId) {
    const [ki] = await db
      .select({ conceptId: tKnowledgeItem.conceptId })
      .from(tKnowledgeItem)
      .where(eq(tKnowledgeItem.id, target.knowledgeItemId));
    conceptId = ki?.conceptId ?? null;
  }
  let subtopicId = target.subtopicId ?? null;
  if (!subtopicId && conceptId) {
    const [c] = await db
      .select({ subtopicId: tConcept.subtopicId })
      .from(tConcept)
      .where(eq(tConcept.id, conceptId));
    subtopicId = c?.subtopicId ?? null;
  }
  if (!subtopicId) return null;
  const [s] = await db
    .select({ topicId: tSubtopic.topicId })
    .from(tSubtopic)
    .where(eq(tSubtopic.id, subtopicId));
  return s?.topicId ?? null;
}

/** Throws unless the session's scope covers the topic. Library-wide sessions cover everything. */
export function assertTopicInScope(session: TSessionS, topicId: string | null, what: string) {
  if (session.scope.kind === "library") return;
  if (topicId && session.scope.topicIds.includes(topicId)) return;
  throw new DomainError(
    "out_of_scope",
    `${what} is outside this session's scope (topics: ${session.scope.topicIds.join(", ") || "none"}).`,
  );
}

/** A library-wide session may only run alone, and topic sessions can't overlap a running one. */
export async function canStartJobForSession(db: TDb, session: TSessionS): Promise<string | null> {
  const running = await db
    .select({ job: tJob, session: tSession })
    .from(tJob)
    .innerJoin(tSession, eq(tJob.sessionId, tSession.id))
    .where(and(eq(tSession.libraryId, session.libraryId), eq(tJob.status, "running")));
  for (const r of running) {
    if (r.session.id === session.id) return "This session already has a running job.";
    if (session.scope.kind === "library" || r.session.scope.kind === "library") {
      return `Waiting for ${r.session.title} to finish (library-wide sessions run alone).`;
    }
    if (r.session.scope.topicIds.some((t) => session.scope.topicIds.includes(t))) {
      return `Waiting for ${r.session.title}, which works on the same topic.`;
    }
  }
  return null;
}
