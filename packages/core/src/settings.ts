import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, isNull, or } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import { tSetting } from "./db/schema/index.ts";
import {
  CARD_TYPES,
  PROVIDERS,
  type CardType,
  type JobKind,
  type ProviderId,
} from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { change } from "./history.ts";

export interface StageProviderSetting {
  provider: ProviderId;
  model: string | null;
  effort: string | null;
}

export const DEFAULT_TRUSTED_SOURCES = [
  "pubmed.ncbi.nlm.nih.gov",
  "www.ncbi.nlm.nih.gov",
  "www.nice.org.uk",
  "www.who.int",
  "radiopaedia.org",
];

/** Stages a provider can be chosen for. `default` applies to any stage left unset. */
export const PROVIDER_STAGES = [
  "default",
  "synthesis",
  "feedback",
  "enrichment",
  "planning",
  "generation",
  "chat",
] as const;
export type ProviderStage = (typeof PROVIDER_STAGES)[number];

export interface SettingDef<T> {
  default: T;
  label: string;
  group: "export" | "enrichment" | "cards" | "providers" | "jobs" | "paths";
  libraryOverride: boolean;
  kind: "text" | "path" | "number" | "bool" | "enum" | "list" | "provider";
  options?: readonly string[];
  parse: (value: unknown) => T;
}

const isString = (v: unknown): v is string => typeof v === "string";

function str(
  label: string,
  group: SettingDef<string>["group"],
  fallback: string,
  libraryOverride = true,
): SettingDef<string> {
  return {
    default: fallback,
    label,
    group,
    libraryOverride,
    kind: "text",
    parse: (v) => {
      if (!isString(v)) throw new DomainError("invalid", `${label} must be text.`);
      return v;
    },
  };
}

function nullableStr(
  label: string,
  group: SettingDef<string | null>["group"],
  libraryOverride = false,
): SettingDef<string | null> {
  return {
    default: null,
    label,
    group,
    libraryOverride,
    kind: "path",
    parse: (v) => {
      if (v === null || v === "") return null;
      if (!isString(v)) throw new DomainError("invalid", `${label} must be text.`);
      return v;
    },
  };
}

function num(
  label: string,
  group: SettingDef<number>["group"],
  fallback: number,
  min: number,
  max: number,
  libraryOverride = false,
): SettingDef<number> {
  return {
    default: fallback,
    label,
    group,
    libraryOverride,
    kind: "number",
    parse: (v) => {
      const n = typeof v === "string" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
        throw new DomainError("invalid", `${label} must be a number from ${min} to ${max}.`);
      }
      return n;
    },
  };
}

function bool(
  label: string,
  group: SettingDef<boolean>["group"],
  fallback: boolean,
  libraryOverride = true,
): SettingDef<boolean> {
  return {
    default: fallback,
    label,
    group,
    libraryOverride,
    kind: "bool",
    parse: (v) => {
      if (typeof v === "boolean") return v;
      if (v === "true" || v === "on") return true;
      if (v === "false" || v === "off") return false;
      throw new DomainError("invalid", `${label} must be on or off.`);
    },
  };
}

function oneOf<T extends string>(
  label: string,
  group: SettingDef<T>["group"],
  values: readonly T[],
  fallback: T,
  libraryOverride = true,
): SettingDef<T> {
  return {
    default: fallback,
    label,
    group,
    libraryOverride,
    kind: "enum",
    options: values,
    parse: (v) => {
      if (!isString(v) || !values.includes(v as T)) {
        throw new DomainError("invalid", `${label} must be one of: ${values.join(", ")}.`);
      }
      return v as T;
    },
  };
}

function list<T extends string>(
  label: string,
  group: SettingDef<T[]>["group"],
  fallback: T[],
  allowed?: readonly T[],
  libraryOverride = true,
): SettingDef<T[]> {
  return {
    default: fallback,
    label,
    group,
    libraryOverride,
    kind: "list",
    options: allowed,
    parse: (v) => {
      const items = isString(v)
        ? v
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : v;
      if (!Array.isArray(items) || !items.every(isString)) {
        throw new DomainError("invalid", `${label} must be a list.`);
      }
      if (allowed && !items.every((i) => allowed.includes(i as T))) {
        throw new DomainError("invalid", `${label} may only contain: ${allowed.join(", ")}.`);
      }
      return items as T[];
    },
  };
}

function providerSetting(stage: ProviderStage): SettingDef<StageProviderSetting | null> {
  return {
    default: stage === "default" ? { provider: "claude", model: null, effort: null } : null,
    label: stage === "default" ? "Default provider" : `Provider for ${stage}`,
    group: "providers",
    libraryOverride: true,
    kind: "provider",
    options: PROVIDERS,
    parse: (v) => {
      if (v === null || v === "") {
        if (stage === "default")
          throw new DomainError("invalid", "The default provider can't be empty.");
        return null;
      }
      const obj = typeof v === "string" ? (JSON.parse(v) as unknown) : v;
      if (typeof obj !== "object" || obj === null)
        throw new DomainError("invalid", "Invalid provider setting.");
      const { provider, model, effort } = obj as Record<string, unknown>;
      if (!isString(provider) || !PROVIDERS.includes(provider as ProviderId)) {
        throw new DomainError("invalid", `Provider must be one of: ${PROVIDERS.join(", ")}.`);
      }
      return {
        provider: provider as ProviderId,
        model: isString(model) && model ? model : null,
        effort: isString(effort) && effort ? effort : null,
      };
    },
  };
}

export const SETTINGS = {
  "export.deckMapping": str("Deck mapping", "export", "{library}::{topic}::{subtopic}"),
  "enrichment.mode": oneOf(
    "Enrichment mode",
    "enrichment",
    ["none", "text", "text+images"] as const,
    "text",
  ),
  "enrichment.trustedSourcesEnabled": bool("Use trusted-source list", "enrichment", true),
  "cards.types": list<CardType>("Card types", "cards", [...CARD_TYPES], CARD_TYPES),
  "cards.priorities": list("Priorities to card", "cards", ["P1", "P2"], [
    "P1",
    "P2",
    "P3",
  ] as const),
  "cards.maxClozePerNote": num("Max cloze deletions per note", "cards", 5, 1, 20, true),
  "cards.uncertainKnowledge": oneOf(
    "Uncertain knowledge",
    "cards",
    ["exclude", "include-with-warning"] as const,
    "exclude",
  ),
  "cards.styleInstructions": str("Card style instructions", "cards", ""),
  "providers.default": providerSetting("default"),
  "providers.synthesis": providerSetting("synthesis"),
  "providers.feedback": providerSetting("feedback"),
  "providers.enrichment": providerSetting("enrichment"),
  "providers.planning": providerSetting("planning"),
  "providers.generation": providerSetting("generation"),
  "providers.chat": providerSetting("chat"),
  "providers.codex.path": nullableStr("Codex CLI path", "providers"),
  "providers.claude.path": nullableStr("Claude Code CLI path", "providers"),
  "jobs.autoTrigger": bool("Start jobs automatically", "jobs", false),
  "jobs.autoSendDelaySec": num("Auto-send feedback after (seconds)", "jobs", 60, 5, 3600),
  "jobs.maxConcurrentPerProvider": num("Max running jobs per provider", "jobs", 2, 1, 8),
  "jobs.resume.maxAttempts": num("Auto-resume attempts", "jobs", 3, 0, 10),
  "jobs.resume.backoffSec": list(
    "Auto-resume waits (seconds)",
    "jobs",
    ["30", "120", "600"],
    undefined,
    false,
  ),
  "jobs.rateLimitWaitMin": num("Wait after a rate limit (minutes)", "jobs", 15, 1, 600),
  "jobs.maxTurns": num("Max turns per job", "jobs", 60, 5, 500),
  "paths.runs": nullableStr("Run folder", "paths"),
  "paths.runsRetentionDays": num("Keep run folders (days)", "paths", 7, 0, 365),
  "paths.readableRoots": list("Folders workers may read", "paths", [homedir()], undefined, false),
  "paths.backupFolder": nullableStr("Backup folder", "paths"),
  "paths.exportFolder": nullableStr("Export folder", "paths"),
} satisfies Record<string, SettingDef<unknown>>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = ReturnType<(typeof SETTINGS)[K]["parse"]>;

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS;
}

export function defaultRunsFolder() {
  return join(tmpdir(), "anki-cards", "runs");
}

export interface ResolvedSetting {
  key: SettingKey;
  value: unknown;
  source: "default" | "global" | "library";
  def: SettingDef<unknown>;
}

async function settingRows(db: TDb, libraryId: string | null) {
  return db
    .select()
    .from(tSetting)
    .where(
      libraryId
        ? or(isNull(tSetting.libraryId), eq(tSetting.libraryId, libraryId))
        : isNull(tSetting.libraryId),
    );
}

export async function getSetting<K extends SettingKey>(
  db: TDb,
  key: K,
  libraryId: string | null = null,
): Promise<SettingValue<K>> {
  const rows = await settingRows(db, libraryId);
  const def = SETTINGS[key];
  const lib =
    libraryId && def.libraryOverride
      ? rows.find((r) => r.key === key && r.libraryId === libraryId)
      : undefined;
  const global = rows.find((r) => r.key === key && r.libraryId === null);
  const raw = lib ? lib.value : global ? global.value : def.default;
  return raw as SettingValue<K>;
}

export async function resolveSettings(
  db: TDb,
  libraryId: string | null,
): Promise<ResolvedSetting[]> {
  const rows = await settingRows(db, libraryId);
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const def = SETTINGS[key] as SettingDef<unknown>;
    const lib =
      libraryId && def.libraryOverride
        ? rows.find((r) => r.key === key && r.libraryId === libraryId)
        : undefined;
    const global = rows.find((r) => r.key === key && r.libraryId === null);
    if (lib) return { key, value: lib.value, source: "library", def };
    if (global) return { key, value: global.value, source: "global", def };
    return { key, value: def.default, source: "default", def };
  });
}

export async function providerForStage(
  db: TDb,
  stage: JobKind | ProviderStage,
  libraryId: string | null,
): Promise<StageProviderSetting> {
  const stageKey = `providers.${stage}`;
  if (isSettingKey(stageKey) && stageKey !== "providers.default") {
    const value = (await getSetting(db, stageKey, libraryId)) as StageProviderSetting | null;
    if (value) return value;
  }
  return (await getSetting(db, "providers.default", libraryId)) as StageProviderSetting;
}

/** Sets (or with `value === undefined`, clears) a setting at global or library scope. */
export async function setSetting(
  db: TDatabase,
  key: string,
  value: unknown,
  libraryId: string | null,
) {
  if (!isSettingKey(key)) throw new DomainError("invalid", `Unknown setting ${key}.`);
  const def = SETTINGS[key] as SettingDef<unknown>;
  if (libraryId && !def.libraryOverride) {
    throw new DomainError("invalid", `${def.label} can only be set globally.`);
  }
  const parsed = value === undefined ? undefined : def.parse(value);
  return change(db, { actor: "user", action: "set_setting", libraryId, note: key }, async (c) => {
    const [existing] = await c.tx
      .select()
      .from(tSetting)
      .where(
        and(
          eq(tSetting.key, key),
          libraryId ? eq(tSetting.libraryId, libraryId) : isNull(tSetting.libraryId),
        ),
      );
    if (parsed === undefined) {
      if (existing) await c.remove("settings", existing.id);
      return null;
    }
    if (existing) return c.update("settings", existing.id, { value: parsed });
    return c.insert("settings", { key, value: parsed }, libraryId);
  });
}
