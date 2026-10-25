import { isSettingKey, resolveSettings, setSetting, type TDb } from "@anki-cards/core";

import { formString } from "./runtime.server";

export interface SettingView {
  key: string;
  label: string;
  group: string;
  kind: string;
  options: string[] | null;
  value: unknown;
  source: "default" | "global" | "library";
  libraryOverride: boolean;
}

export async function settingViews(db: TDb, libraryId: string | null): Promise<SettingView[]> {
  const resolved = await resolveSettings(db, libraryId);
  return resolved
    .filter((r) => libraryId === null || r.def.libraryOverride)
    .map((r) => ({
      key: r.key,
      label: r.def.label,
      group: r.def.group,
      kind: r.def.kind,
      options: r.def.options ? [...r.def.options] : null,
      value: r.value,
      source: r.source,
      libraryOverride: r.def.libraryOverride,
    }));
}

/** Handles the settings form: `intent` is `save` or `reset`. */
export async function saveSettingFromForm(
  db: Parameters<typeof setSetting>[0],
  form: FormData,
  libraryId: string | null,
) {
  const key = formString(form, "key");
  if (!isSettingKey(key)) return { error: `Unknown setting ${key}` };
  if (formString(form, "intent") === "reset") {
    await setSetting(db, key, undefined, libraryId);
    return { ok: true, message: "Reset" };
  }
  const kind = formString(form, "kind");
  let value: unknown;
  if (kind === "bool") value = form.get("value") === "on";
  else if (kind === "provider") {
    const provider = formString(form, "provider");
    value = provider
      ? { provider, model: formString(form, "model"), effort: formString(form, "effort") }
      : null;
  } else value = formString(form, "value");
  await setSetting(db, key, value, libraryId);
  return { ok: true, message: "Saved" };
}
