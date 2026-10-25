import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DetectedTool, DetectedTools } from "./types.ts";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs an executable directly (no shell) and collects its output. */
export function runProcess(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${executable} timed out after ${timeoutMs} ms`));
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

/** Creates a temporary directory, passes it to `fn` and removes it afterwards. */
export async function withTempDir<T>(
  parent: string | undefined,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(parent ?? tmpdir(), "anki-ingest-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findOnPath(names: string[]): string | undefined {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of extname(name) ? [""] : extensions) {
        const candidate = join(dir, name + ext.toLowerCase());
        if (isFile(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

/**
 * On Windows soffice.exe detaches from the console; the soffice.com wrapper next to it
 * waits for the conversion and forwards output.
 */
export function libreOfficeConsoleExecutable(path: string): string {
  if (process.platform !== "win32" || !path.toLowerCase().endsWith("soffice.exe")) return path;
  const wrapper = join(dirname(path), "soffice.com");
  return existsSync(wrapper) ? wrapper : path;
}

function libreOfficeCandidates(): string[] {
  const candidates: string[] = [];
  const onPath = findOnPath(["soffice", "libreoffice"]);
  if (onPath) candidates.push(onPath);
  if (process.platform === "win32") {
    for (const root of [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      "C:\\Program Files",
    ]) {
      if (root) candidates.push(join(root, "LibreOffice", "program", "soffice.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  }
  return candidates;
}

async function probeVersion(path: string, pattern: RegExp): Promise<DetectedTool | null> {
  try {
    const result = await runProcess(path, ["--version"], 15_000);
    const version = pattern.exec(`${result.stdout}\n${result.stderr}`)?.[1];
    return version ? { path, version } : { path };
  } catch (error) {
    // The file exists but would not start (wrong architecture, missing libraries, permissions).
    if (error instanceof Error && "code" in error) return null;
    // Timed out: the binary is there, its version is unknown.
    return { path };
  }
}

/** Finds LibreOffice and ffmpeg and reads their versions. */
export async function detectTools(): Promise<DetectedTools> {
  const libreOfficePath = libreOfficeCandidates().find(isFile);
  const envFfmpeg = process.env.FFMPEG_PATH;
  const ffmpegPath = envFfmpeg && isFile(envFfmpeg) ? envFfmpeg : findOnPath(["ffmpeg"]);
  const [libreOffice, ffmpeg] = await Promise.all([
    libreOfficePath
      ? probeVersion(libreOfficeConsoleExecutable(libreOfficePath), /LibreOffice\s+([\d.]+)/).then(
          (tool) => (tool ? { ...tool, path: libreOfficePath } : null),
        )
      : null,
    ffmpegPath ? probeVersion(ffmpegPath, /ffmpeg version (\S+)/) : null,
  ]);
  return { libreOffice, ffmpeg };
}

/** Converts an office document to PDF with LibreOffice in a throwaway profile. */
export async function convertToPdf(
  sofficePath: string,
  extension: string,
  bytes: Uint8Array,
  tempDir: string | undefined,
): Promise<Uint8Array> {
  return withTempDir(tempDir, async (dir) => {
    const input = join(dir, `source.${extension}`);
    const outDir = join(dir, "out");
    const profile = join(dir, "profile");
    await mkdir(outDir);
    await writeFile(input, bytes);
    const result = await runProcess(
      libreOfficeConsoleExecutable(sofficePath),
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        input,
      ],
      180_000,
    );
    const output = join(outDir, "source.pdf");
    if (!isFile(output)) {
      const detail = (result.stderr || result.stdout).trim().slice(0, 500);
      throw new Error(
        `LibreOffice produced no PDF (exit ${result.code})${detail ? `: ${detail}` : ""}`,
      );
    }
    return new Uint8Array(await readFile(output));
  });
}
