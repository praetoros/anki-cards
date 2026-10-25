import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";

import { eq } from "drizzle-orm";

import type { TDb } from "../db/client.ts";
import { nowIso } from "../db/helpers.ts";
import { tProviderCheck, type TProviderCheckS } from "../db/schema/index.ts";
import { PROVIDERS, type ProviderId } from "../domain/enums.ts";
import { emitChange, emitNotice } from "../events.ts";
import { withWriteLock } from "../lock.ts";
import { getSetting } from "../settings.ts";

export const MIN_VERSION: Record<ProviderId, string> = { claude: "2.1.259", codex: "0.122.0" };

export const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude Code", codex: "Codex" };

export const SETUP_HELP: Record<ProviderId, { install: string; login: string; update: string }> = {
  claude: {
    install: "Install Claude Code: https://code.claude.com/docs/en/setup",
    login: "Run `claude` once in a terminal and sign in with your Claude subscription.",
    update: "Run `claude update`.",
  },
  codex: {
    install: "Install Codex: https://learn.chatgpt.com/codex (CLI), e.g. `npm i -g @openai/codex`.",
    login: "Run `codex login` and sign in with ChatGPT.",
    update: "Run `npm i -g @openai/codex@latest` (or your installer's update command).",
  },
};

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Node scripts (used by the test fake CLI) run under the current Node binary. */
export function executableFor(path: string): { file: string; prefix: string[] } {
  const ext = extname(path).toLowerCase();
  if (ext === ".mjs" || ext === ".js" || ext === ".ts")
    return { file: process.execPath, prefix: [path] };
  return { file: path, prefix: [] };
}

export function runCommand(
  path: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<CommandResult> {
  const { file, prefix } = executableFor(path);
  return new Promise((resolve) => {
    execFile(
      file,
      [...prefix, ...args],
      { timeout: timeoutMs, windowsHide: true, env: workerEnv({}) },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** Environment for spawned CLIs: API keys removed so the subscription login is used. */
export function workerEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
  ]) {
    delete env[key];
  }
  return env;
}

function onPath(names: string[]): string | null {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (dir && existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** npm installs Codex as a `.cmd` shim; the real binary sits in the package's vendor folder. */
function codexVendorBinary(shim: string): string | null {
  const pkg = join(dirname(shim), "node_modules", "@openai", "codex", "vendor");
  if (!existsSync(pkg)) return null;
  for (const triple of readdirSync(pkg)) {
    const exe = join(pkg, triple, "codex", process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(exe)) return exe;
  }
  return null;
}

export async function findProvider(db: TDb, provider: ProviderId): Promise<string | null> {
  const configured = await getSetting(
    db,
    provider === "claude" ? "providers.claude.path" : "providers.codex.path",
  );
  if (configured) return existsSync(configured) ? configured : null;
  const win = process.platform === "win32";
  if (provider === "claude") {
    const found = onPath(win ? ["claude.exe"] : ["claude"]);
    if (found) return found;
    const defaults = win
      ? [join(homedir(), ".local", "bin", "claude.exe")]
      : [join(homedir(), ".local", "bin", "claude"), join(homedir(), ".claude", "local", "claude")];
    return defaults.find((p) => existsSync(p)) ?? null;
  }
  const exe = onPath(win ? ["codex.exe"] : ["codex"]);
  if (exe) return exe;
  const shim = win ? onPath(["codex.cmd"]) : null;
  if (shim) return codexVendorBinary(shim);
  return null;
}

export interface ProviderStatus extends TProviderCheckS {
  label: string;
  minVersion: string;
  help: string[];
}

async function saveCheck(db: TDb, row: Omit<TProviderCheckS, "checkedAt">) {
  const values = { ...row, checkedAt: nowIso() };
  await withWriteLock(() =>
    db
      .insert(tProviderCheck)
      .values(values)
      .onConflictDoUpdate({ target: tProviderCheck.provider, set: values }),
  );
  emitChange({ libraryId: null, tables: ["provider_checks"], changesetId: null });
}

/** Install, version and login check. Uses no quota. */
export async function checkProvider(db: TDb, provider: ProviderId): Promise<ProviderStatus> {
  const [previous] = await db
    .select()
    .from(tProviderCheck)
    .where(eq(tProviderCheck.provider, provider));
  const help = SETUP_HELP[provider];
  const path = await findProvider(db, provider);
  let version: string | null = null;
  let loggedIn = false;
  let message = "";
  if (!path) {
    message = `${PROVIDER_LABEL[provider]} was not found. ${help.install} Or set its path in Settings.`;
  } else {
    const v = await runCommand(path, ["--version"]);
    version = /(\d+\.\d+\.\d+)/.exec(v.stdout + v.stderr)?.[1] ?? null;
    if (!version) message = `Could not read the ${PROVIDER_LABEL[provider]} version.`;
    else if (compareVersions(version, MIN_VERSION[provider]) < 0) {
      message = `${PROVIDER_LABEL[provider]} ${version} is older than the required ${MIN_VERSION[provider]}. ${help.update}`;
    }
    const status = await runCommand(
      path,
      provider === "claude" ? ["auth", "status"] : ["login", "status"],
    );
    if (provider === "claude") {
      try {
        loggedIn = (JSON.parse(status.stdout) as { loggedIn?: boolean }).loggedIn === true;
      } catch {
        loggedIn = status.code === 0;
      }
    } else {
      loggedIn = status.code === 0;
    }
    if (!loggedIn && !message)
      message = `${PROVIDER_LABEL[provider]} is not signed in. ${help.login}`;
  }
  const ok = Boolean(
    path && version && loggedIn && compareVersions(version, MIN_VERSION[provider]) >= 0,
  );
  const row = {
    provider,
    path,
    version,
    loggedIn,
    ok,
    message: ok ? "Ready" : message,
    testOk: previous?.testOk ?? null,
    testMessage: previous?.testMessage ?? null,
    testedAt: previous?.testedAt ?? null,
  };
  await saveCheck(db, row);
  return {
    ...row,
    checkedAt: nowIso(),
    label: PROVIDER_LABEL[provider],
    minVersion: MIN_VERSION[provider],
    help: Object.values(help),
  };
}

export async function checkAllProviders(db: TDb, notify = false) {
  const results = await Promise.all(PROVIDERS.map((p) => checkProvider(db, p)));
  if (notify && results.every((r) => !r.ok)) {
    emitNotice({
      level: "warning",
      title: "No AI provider is ready",
      message: results.map((r) => `${r.label}: ${r.message}`).join(" "),
    });
  }
  return results;
}

export async function providerStatuses(db: TDb): Promise<ProviderStatus[]> {
  const rows = await db.select().from(tProviderCheck);
  return PROVIDERS.map((p) => {
    const row = rows.find((r) => r.provider === p);
    const base: TProviderCheckS = row ?? {
      provider: p,
      path: null,
      version: null,
      loggedIn: false,
      ok: false,
      message: "Not checked yet",
      testOk: null,
      testMessage: null,
      testedAt: null,
      checkedAt: "",
    };
    return {
      ...base,
      label: PROVIDER_LABEL[p],
      minVersion: MIN_VERSION[p],
      help: Object.values(SETUP_HELP[p]),
    };
  });
}

export async function recordProviderTest(
  db: TDb,
  provider: ProviderId,
  ok: boolean,
  message: string,
) {
  await withWriteLock(() =>
    db
      .update(tProviderCheck)
      .set({ testOk: ok, testMessage: message, testedAt: nowIso() })
      .where(eq(tProviderCheck.provider, provider)),
  );
  emitChange({ libraryId: null, tables: ["provider_checks"], changesetId: null });
}
