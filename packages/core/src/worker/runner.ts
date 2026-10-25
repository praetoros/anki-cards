import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { and, eq, isNotNull } from "drizzle-orm";

import type { TDatabase } from "../db/client.ts";
import { nowIso } from "../db/helpers.ts";
import { tJob, tSession, type JobUsage, type TJobS } from "../db/schema/index.ts";
import type { ProviderId } from "../domain/enums.ts";
import { bus, emitNotice } from "../events.ts";
import { addJobEvent, getJob, startableJobs, updateJob } from "../jobs.ts";
import type { Runtime } from "../runtime.ts";
import {
  canStartJobForSession,
  getSession,
  issueSessionToken,
  updateSession,
} from "../sessions.ts";
import { defaultRunsFolder, getSetting } from "../settings.ts";
import { claudeArgs, claudeMcpConfig, codexArgs, type InvocationOptions } from "./commands.ts";
import { codexTokenStatus } from "./codex-rollout.ts";
import { parseClaudeLine, parseCodexLine, type WorkerEvent } from "./events.ts";
import {
  checkProvider,
  executableFor,
  findProvider,
  recordProviderTest,
  recordProviderUsage,
  workerEnv,
} from "./providers.ts";
import { finishCompaction, recordJobFailure } from "../session-actions.ts";
import { cleanupRunFolders, prepareRunFolder } from "./run-folder.ts";
import { jobUsesWeb, toolsForJob } from "./stage-tools.ts";

interface Running {
  job: TJobS;
  child: ChildProcess;
  cancelled: boolean;
  stopReason: string | null;
  rateLimit: { resetsAt?: string } | null;
  finished: { ok: boolean; summary?: string } | null;
  completedByTool: string | null;
  lastToolError: { key: string; count: number } | null;
  usage: JobUsage;
  stderr: string;
  limitWarned: boolean;
}

const CODEX_LIMIT_WARN_PERCENT = 80;

const RESUME_PROMPT =
  "The previous run of this job stopped before it finished. Call get_workflow_state, check what is already done, and continue the task:\n\n";

export class JobRunner {
  private running = new Map<string, Running>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private stopped = false;

  constructor(
    private readonly db: TDatabase,
    private readonly mcpUrl: () => string,
  ) {}

  start() {
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), 2000);
    bus.on("change", (e) => {
      if (e.tables.includes("jobs")) void this.tick();
    });
    void this.recoverInterrupted().then(() => this.tick());
    void this.refreshCodexContexts();
  }

  /** Sessions saved before the context came from Codex's session file hold turn totals. */
  private async refreshCodexContexts() {
    const sessions = await this.db
      .select()
      .from(tSession)
      .where(and(eq(tSession.provider, "codex"), isNotNull(tSession.cliSessionId)));
    for (const session of sessions) {
      const status = await codexTokenStatus(session.cliSessionId!).catch(() => null);
      if (status && status.contextTokens !== session.contextTokens)
        await updateSession(this.db, session.id, {
          contextTokens: status.contextTokens,
          contextWindow: status.contextWindow,
        });
    }
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const r of this.running.values()) {
      r.cancelled = true;
      killTree(r.child);
    }
  }

  isRunning(jobId: string) {
    return this.running.has(jobId);
  }

  /** Jobs left `running` by a previous process are resumed. */
  private async recoverInterrupted() {
    const stale = await this.db.select().from(tJob).where(eq(tJob.status, "running"));
    for (const job of stale) {
      await updateJob(this.db, job.id, {
        status: "waiting",
        trigger: "resume",
        resumeAfter: nowIso(),
      });
    }
  }

  async cancel(jobId: string) {
    const r = this.running.get(jobId);
    if (r) {
      r.cancelled = true;
      killTree(r.child);
      return;
    }
    await updateJob(this.db, jobId, { status: "cancelled", finishedAt: nowIso() });
  }

  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const max = await getSetting(this.db, "jobs.maxConcurrentPerProvider");
      for (const job of await startableJobs(this.db)) {
        if (this.running.has(job.id)) continue;
        const perProvider = [...this.running.values()].filter(
          (r) => r.job.provider === job.provider,
        ).length;
        if (perProvider >= max) continue;
        const session = await getSession(this.db, job.sessionId);
        if (session.status === "archived") {
          await updateJob(this.db, job.id, {
            status: "cancelled",
            error: "Session archived",
            finishedAt: nowIso(),
          });
          continue;
        }
        if (await canStartJobForSession(this.db, session)) continue;
        await this.launch(job);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async launch(queued: TJobS) {
    const db = this.db;
    const session = await getSession(db, queued.sessionId);
    const provider: ProviderId = session.provider;
    const path = await findProvider(db, provider);
    const check = path ? await checkProvider(db, provider) : null;
    if (!path || !check?.ok) {
      await updateJob(db, queued.id, {
        status: "paused",
        error: check?.message ?? `${provider} is not installed.`,
      });
      emitNotice({
        level: "warning",
        title: "Job paused",
        message: check?.message ?? `${provider} is not available.`,
      });
      return;
    }

    const isResume = queued.trigger === "resume" || queued.attempt > 0;
    const runsRoot = (await getSetting(db, "paths.runs")) ?? defaultRunsFolder();
    void cleanupRunFolders(runsRoot, await getSetting(db, "paths.runsRetentionDays")).catch(
      () => 0,
    );
    const { dir } = await prepareRunFolder(runsRoot, queued.id, queued.kind);
    const enrichmentMode = await getSetting(db, "enrichment.mode", session.libraryId);
    const token = await issueSessionToken(db, session.id);

    let cliSessionId = session.cliSessionId;
    const resume = Boolean(cliSessionId);
    if (!cliSessionId && provider === "claude") {
      cliSessionId = randomUUID();
      await updateSession(db, session.id, { cliSessionId });
    }

    const options: InvocationOptions = {
      provider,
      mcpUrl: this.mcpUrl(),
      tools: toolsForJob(queued.kind),
      webSearch: jobUsesWeb(queued.kind, enrichmentMode),
      model: queued.model,
      effort: queued.effort,
      cliSessionId,
      resume,
      runDir: dir,
      maxTurns: await getSetting(db, "jobs.maxTurns"),
    };
    let args: string[];
    if (provider === "claude") {
      const mcpConfig = join(dir, "mcp.json");
      await writeFile(mcpConfig, JSON.stringify(claudeMcpConfig(options.mcpUrl), null, 2));
      args = claudeArgs(options, { mcpConfig, stagePrompt: join(dir, "stage.md") });
    } else {
      args = codexArgs(options);
    }
    const { file, prefix } = executableFor(path);
    await writeFile(
      join(dir, "command.json"),
      JSON.stringify({ file, args: [...prefix, ...args] }, null, 2),
    );

    const job = await updateJob(db, queued.id, {
      status: "running",
      startedAt: nowIso(),
      attempt: queued.attempt + 1,
      runDir: dir,
      error: null,
      resumeAfter: null,
    });
    if (!job) return;
    await updateSession(db, session.id, { status: "running" });

    const child = spawn(file, [...prefix, ...args], {
      cwd: dir,
      env: workerEnv({
        ANKI_MCP_TOKEN: token,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      }),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const state: Running = {
      job,
      child,
      cancelled: false,
      stopReason: null,
      rateLimit: null,
      finished: null,
      completedByTool: null,
      lastToolError: null,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      stderr: "",
      limitWarned: false,
    };
    this.running.set(job.id, state);
    await addJobEvent(db, job, "started", {
      provider,
      attempt: job.attempt,
      resume: isResume,
      runDir: dir,
    });

    child.stdin?.end(isResume && job.attempt > 1 ? RESUME_PROMPT + job.prompt : job.prompt);
    child.stderr?.on("data", (chunk: Buffer) => {
      state.stderr = (state.stderr + chunk.toString()).slice(-8000);
    });
    const parse = provider === "claude" ? parseClaudeLine : parseCodexLine;
    const lines = createInterface({ input: child.stdout! });
    const pending: Promise<unknown>[] = [];
    lines.on("line", (line) => {
      for (const event of parse(line)) pending.push(this.onEvent(state, event));
    });

    child.on("error", (error) => {
      state.stopReason = error.message;
    });
    child.on("close", (code) => {
      void Promise.allSettled(pending).then(() => this.onExit(state, code ?? 1));
    });
  }

  private async onEvent(state: Running, event: WorkerEvent) {
    const db = this.db;
    const { job } = state;
    switch (event.type) {
      case "session_started":
        if (event.cliSessionId)
          await updateSession(db, job.sessionId, { cliSessionId: event.cliSessionId });
        break;
      case "usage":
        state.usage.inputTokens += event.inputTokens;
        state.usage.cachedInputTokens += event.cachedInputTokens;
        state.usage.outputTokens += event.outputTokens;
        if (job.provider === "codex") await this.syncCodexContext(state);
        else await updateSession(db, job.sessionId, { contextTokens: event.contextTokens });
        break;
      case "rate_limit":
        state.rateLimit = { resetsAt: event.resetsAt };
        break;
      case "finished":
        state.finished = { ok: event.ok, summary: event.summary };
        if (event.costUsd !== undefined) state.usage.costUsd = event.costUsd;
        break;
      case "tool_call":
        if (event.status === "failed") {
          const key = `${event.name}:${event.result ?? ""}`;
          state.lastToolError =
            state.lastToolError?.key === key
              ? { key, count: state.lastToolError.count + 1 }
              : { key, count: 1 };
          if (state.lastToolError.count >= 3) {
            state.stopReason = `The same tool error happened 3 times in a row: ${event.result ?? event.name}`;
            killTree(state.child);
          }
        } else if (event.status === "completed") {
          state.lastToolError = null;
          if (event.name === "complete_job") state.completedByTool = event.result ?? "";
        }
        break;
      default:
        break;
    }
    await addJobEvent(db, job, event.type, event as unknown as Record<string, unknown>);
  }

  /** Codex's JSON stream has no context size, so it is read from the session file Codex writes. */
  private async syncCodexContext(state: Running) {
    const session = await getSession(this.db, state.job.sessionId);
    if (!session.cliSessionId) return;
    const status = await codexTokenStatus(session.cliSessionId).catch(() => null);
    if (!status) return;
    await updateSession(this.db, session.id, {
      contextTokens: status.contextTokens,
      contextWindow: status.contextWindow,
    });
    const limit = status.rateLimit;
    if (limit) await recordProviderUsage(this.db, "codex", { ...limit, credits: status.credits });
    if (limit && limit.usedPercent >= CODEX_LIMIT_WARN_PERCENT && !state.limitWarned) {
      state.limitWarned = true;
      emitNotice({
        level: "warning",
        title: "Codex usage limit",
        message: `Codex has used ${Math.round(limit.usedPercent)}% of its usage limit${
          limit.resetsAt ? `; it resets ${limit.resetsAt}` : ""
        }.`,
      });
    }
  }

  private async onExit(state: Running, code: number) {
    const db = this.db;
    this.running.delete(state.job.id);
    if (state.job.provider === "codex") await this.syncCodexContext(state);
    const job = await getJob(db, state.job.id);
    const usage = {
      ...state.usage,
      durationMs: job.startedAt ? Date.now() - Date.parse(job.startedAt) : undefined,
    };
    const session = await getSession(db, job.sessionId);
    await updateSession(db, session.id, { status: "idle", jobCount: session.jobCount + 1 });
    const finishedAt = nowIso();

    if (state.cancelled) {
      await updateJob(db, job.id, { status: "cancelled", usage, finishedAt, exitCode: code });
      await addJobEvent(db, job, "ended", { status: "cancelled" });
      return;
    }
    const ok = code === 0 && !state.stopReason && (state.finished ? state.finished.ok : true);
    if (ok) {
      await updateJob(db, job.id, { status: "done", usage, finishedAt, exitCode: code });
      await addJobEvent(db, job, "ended", {
        status: "done",
        summary: state.finished?.summary ?? state.completedByTool,
      });
      if (job.kind === "ping")
        await recordProviderTest(
          db,
          job.provider,
          Boolean(state.completedByTool !== null || state.finished?.ok),
          "Test run finished",
        );
      if (job.kind === "compact") await finishCompaction(db, job);
      return;
    }

    const stderr = state.stderr.trim();
    const reason =
      state.stopReason ?? (stderr.split("\n").slice(-3).join(" ") || `Exited with code ${code}`);
    if (state.lastToolError && state.lastToolError.count >= 3) {
      await updateJob(db, job.id, {
        status: "failed",
        error: reason,
        usage,
        finishedAt,
        exitCode: code,
      });
      await addJobEvent(db, job, "ended", { status: "failed", error: reason });
      await recordJobFailure(db, job, true, reason);
      bus.emit("job", {
        jobId: job.id,
        sessionId: job.sessionId,
        libraryId: job.libraryId,
        type: "job_failed",
        data: { error: reason },
      });
      return;
    }
    if (state.rateLimit || /rate.?limit|usage limit|quota/i.test(stderr)) {
      const waitMin = await getSetting(db, "jobs.rateLimitWaitMin");
      const resumeAfter =
        state.rateLimit?.resetsAt ?? new Date(Date.now() + waitMin * 60_000).toISOString();
      await updateJob(db, job.id, {
        status: "waiting",
        trigger: "resume",
        resumeAfter,
        attempt: job.attempt - 1,
        error: "Rate limited",
        usage,
      });
      await addJobEvent(db, job, "ended", {
        status: "waiting",
        resumeAfter,
        error: "Rate limited",
      });
      return;
    }
    if (/not logged in|log in|login|unauthori[sz]ed|401/i.test(stderr)) {
      await updateJob(db, job.id, { status: "paused", error: reason, usage });
      await checkProvider(db, job.provider);
      await addJobEvent(db, job, "ended", { status: "paused", error: reason });
      emitNotice({ level: "warning", title: "Job paused", message: reason });
      return;
    }
    const maxAttempts = await getSetting(db, "jobs.resume.maxAttempts");
    const backoff = (await getSetting(db, "jobs.resume.backoffSec")).map(Number);
    if (job.kind !== "ping" && job.attempt <= maxAttempts) {
      const wait = backoff[Math.min(job.attempt - 1, backoff.length - 1)] ?? 60;
      const resumeAfter = new Date(Date.now() + wait * 1000).toISOString();
      await updateJob(db, job.id, {
        status: "waiting",
        trigger: "resume",
        resumeAfter,
        error: reason,
        usage,
        exitCode: code,
      });
      await addJobEvent(db, job, "ended", { status: "waiting", resumeAfter, error: reason });
      return;
    }
    await updateJob(db, job.id, {
      status: "failed",
      error: reason,
      usage,
      finishedAt,
      exitCode: code,
    });
    await addJobEvent(db, job, "ended", { status: "failed", error: reason });
    if (job.kind === "ping") await recordProviderTest(db, job.provider, false, reason);
    else await recordJobFailure(db, job, false, reason);
    bus.emit("job", {
      jobId: job.id,
      sessionId: job.sessionId,
      libraryId: job.libraryId,
      type: "job_failed",
      data: { error: reason },
    });
  }

  /** Re-queues jobs paused for a provider problem once that provider is ready again. */
  async resumePaused(provider: ProviderId) {
    const paused = await this.db
      .select()
      .from(tJob)
      .where(and(eq(tJob.status, "paused"), eq(tJob.provider, provider)));
    for (const job of paused) await updateJob(this.db, job.id, { status: "queued", error: null });
  }
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

const runnerKey = Symbol.for("anki-cards.job-runner");
const store = globalThis as unknown as Record<symbol, JobRunner | undefined>;

export function getRunner(): JobRunner | undefined {
  return store[runnerKey];
}

export function startRunner(runtime: Runtime) {
  const existing = store[runnerKey];
  if (existing) return existing;
  const runner = new JobRunner(runtime.db, () => runtime.mcpUrl);
  store[runnerKey] = runner;
  runner.start();
  return runner;
}
