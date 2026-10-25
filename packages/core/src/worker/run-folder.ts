import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { JobKind } from "../domain/enums.ts";
import { repoRoot } from "../paths.ts";

export const skillsRoot = join(repoRoot, "skills");

/** Skill folders each job kind gets, in addition to the shared worker rules. */
const KIND_SKILLS: Record<JobKind, string[]> = {
  ping: [],
  synthesis: ["anki-synthesis"],
  feedback: ["anki-synthesis", "anki-feedback", "anki-cards"],
  enrichment: ["anki-synthesis", "anki-enrichment"],
  planning: ["anki-cards"],
  generation: ["anki-cards"],
  card_review: ["anki-cards", "anki-feedback"],
  chat: ["anki-chat", "anki-synthesis", "anki-feedback", "anki-enrichment", "anki-cards"],
  compact: [],
};

export function skillsForJob(kind: JobKind) {
  return KIND_SKILLS[kind];
}

/** The git repository that contains `dir`, if any. */
export function gitRootAbove(dir: string): string | null {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readSkillBody(name: string): Promise<string> {
  const file = join(skillsRoot, name, "SKILL.md");
  if (!existsSync(file)) return "";
  const text = await readFile(file, "utf8");
  return text.replace(/^---[\s\S]*?---\s*/, "");
}

/**
 * Builds a job's working folder: worker rules and stage instructions as AGENTS.md / CLAUDE.md
 * and stage.md, plus the stage skill folders for both CLIs.
 */
export async function prepareRunFolder(runsRoot: string, jobId: string, kind: JobKind) {
  const dir = join(runsRoot, jobId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const skills = skillsForJob(kind);
  const sections = [await readSkillBody("anki-worker")];
  for (const skill of skills) {
    const src = join(skillsRoot, skill);
    if (!existsSync(src)) continue;
    await cp(src, join(dir, ".agents", "skills", skill), { recursive: true });
    await cp(src, join(dir, ".claude", "skills", skill), { recursive: true });
    sections.push(await readSkillBody(skill));
  }
  const instructions = sections.filter(Boolean).join("\n\n---\n\n");
  await writeFile(join(dir, "AGENTS.md"), instructions);
  await writeFile(join(dir, "CLAUDE.md"), instructions);
  await writeFile(join(dir, "stage.md"), instructions);
  return { dir, instructions };
}

export async function cleanupRunFolders(runsRoot: string, retentionDays: number) {
  if (!existsSync(runsRoot)) return 0;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let removed = 0;
  for (const entry of await readdir(runsRoot)) {
    const path = join(runsRoot, entry);
    const info = await stat(path);
    if (info.mtimeMs < cutoff) {
      await rm(path, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
