import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDb,
  createLibrary,
  createSession,
  enqueueJob,
  getJob,
  JobRunner,
  resolvePaths,
  runMigrations,
  setSetting,
  type JobKind,
  type ProviderId,
  type Runtime,
  type SessionScope,
  type TJobS,
} from "@anki-cards/core";

import { createAnkiMcpHandler } from "../src/handler.ts";

export const fakeCli = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));

export interface Harness {
  runtime: Runtime;
  runner: JobRunner;
  url: string;
  dir: string;
  libraryId: string;
  scenario: (steps: unknown[], exitCode?: number) => void;
  runJob: (opts: {
    kind: JobKind;
    provider?: ProviderId;
    scope?: SessionScope;
    prompt?: string;
  }) => Promise<TJobS>;
  close: () => Promise<void>;
}

async function toRequest(req: import("node:http").IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  return new Request(new URL(req.url ?? "/", base), {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
}

export async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "anki-cards-mcp-"));
  const db = createDb(join(dir, "test.db"));
  runMigrations(db);
  const paths = resolvePaths(join(dir, "data"));
  let server: Server | undefined;
  const runtime: Runtime = { db, paths, port: 0, mcpUrl: "" };
  const mcp = createAnkiMcpHandler(async () => runtime);
  server = createServer(async (req, res) => {
    const response = await mcp.fetch(await toRequest(req, `http://127.0.0.1:${runtime.port}`));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  runtime.port = typeof address === "object" && address ? address.port : 0;
  runtime.mcpUrl = `http://127.0.0.1:${runtime.port}/mcp`;

  await setSetting(db, "providers.claude.path", fakeCli, null);
  await setSetting(db, "providers.codex.path", fakeCli, null);
  await setSetting(db, "paths.runs", join(dir, "runs"), null);
  await setSetting(db, "jobs.resume.backoffSec", "0,0,0", null);
  const lib = await createLibrary(db, { name: "Test library" });
  const runner = new JobRunner(db, () => runtime.mcpUrl);
  runner.start();

  const scenarioFile = join(dir, "scenario.json");
  process.env["FAKE_CLI_SCENARIO"] = scenarioFile;
  // Keeps the app and the fake Codex away from the real ~/.codex session files.
  process.env["CODEX_HOME"] = join(dir, "codex-home");
  const scenario = (steps: unknown[], exitCode = 0) =>
    writeFileSync(scenarioFile, JSON.stringify({ steps, exitCode }));
  scenario([{ tool: "ping" }, { tool: "complete_job", args: { summary: "pong" } }]);

  return {
    runtime,
    runner,
    url: runtime.mcpUrl,
    dir,
    libraryId: lib.id,
    scenario,
    runJob: async ({
      kind,
      provider = "claude",
      scope = { kind: "library", topicIds: [] },
      prompt = "test",
    }) => {
      const session = await createSession(db, {
        libraryId: lib.id,
        kind: "ingest",
        title: "Test",
        scope,
        provider,
      });
      const job = await enqueueJob(db, { sessionId: session.id, kind, trigger: "test", prompt });
      void runner.tick();
      return waitForJob(db, job.id);
    },
    close: async () => {
      await runner.stop();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function waitForJob(
  db: Runtime["db"],
  jobId: string,
  statuses = ["done", "failed", "cancelled", "paused"],
  timeoutMs = 20_000,
) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const job = await getJob(db, jobId);
    if (statuses.includes(job.status)) return job;
    if (Date.now() > end) throw new Error(`Job ${jobId} still ${job.status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
