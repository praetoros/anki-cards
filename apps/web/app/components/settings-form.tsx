import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Input } from "@anki-cards/ui/components/input";
import { useFetcher } from "react-router";

import type { SettingView } from "~/lib/settings.server";

const GROUP_LABELS: Record<string, string> = {
  providers: "AI providers",
  jobs: "Jobs",
  enrichment: "Enrichment",
  cards: "Cards",
  export: "Export",
  paths: "Folders",
};

export const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}

function SettingRow({ setting, scope }: { setting: SettingView; scope: "global" | "library" }) {
  const fetcher = useFetcher<{ error?: string; message?: string }>();
  const inherited = scope === "library" && setting.source !== "library";
  const provider =
    setting.kind === "provider"
      ? (setting.value as { provider: string; model: string | null; effort: string | null } | null)
      : null;

  return (
    <fetcher.Form
      method="post"
      className="grid gap-2 border-b py-3 md:grid-cols-[220px_1fr_auto] md:items-center"
    >
      <input type="hidden" name="key" value={setting.key} />
      <input type="hidden" name="kind" value={setting.kind} />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{setting.label}</span>
        <span className="flex gap-1">
          <Badge variant={setting.source === "default" ? "outline" : "secondary"}>
            {inherited ? `inherits ${setting.source}` : setting.source}
          </Badge>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {setting.kind === "bool" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="value"
              defaultChecked={setting.value === true}
              className="size-4"
            />{" "}
            On
          </label>
        )}
        {setting.kind === "enum" && (
          <select name="value" defaultValue={valueText(setting.value)} className={selectClass}>
            {setting.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        {setting.kind === "provider" && (
          <>
            <select name="provider" defaultValue={provider?.provider ?? ""} className={selectClass}>
              {setting.key !== "providers.default" && <option value="">Use default</option>}
              {setting.options?.map((o) => (
                <option key={o} value={o}>
                  {o === "claude" ? "Claude Code" : "Codex"}
                </option>
              ))}
            </select>
            <Input
              name="model"
              defaultValue={provider?.model ?? ""}
              placeholder="Model (CLI default)"
              className="w-48"
            />
            <select name="effort" defaultValue={provider?.effort ?? ""} className={selectClass}>
              <option value="">Effort (default)</option>
              {["low", "medium", "high", "xhigh", "max"].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </>
        )}
        {(setting.kind === "text" ||
          setting.kind === "path" ||
          setting.kind === "number" ||
          setting.kind === "list") && (
          <Input
            name="value"
            type={setting.kind === "number" ? "number" : "text"}
            defaultValue={valueText(setting.value)}
            placeholder={setting.kind === "path" ? "Not set" : undefined}
            className="min-w-64 flex-1"
          />
        )}
        {fetcher.data?.error && (
          <span className="text-sm text-destructive">{fetcher.data.error}</span>
        )}
        {fetcher.data?.message && !fetcher.data.error && (
          <span className="text-sm text-muted-foreground">{fetcher.data.message}</span>
        )}
      </div>
      <div className="flex gap-1">
        <Button
          type="submit"
          size="sm"
          name="intent"
          value="save"
          disabled={fetcher.state !== "idle"}
        >
          Save
        </Button>
        {((scope === "library" && setting.source === "library") ||
          (scope === "global" && setting.source === "global")) && (
          <Button type="submit" size="sm" variant="ghost" name="intent" value="reset">
            Reset
          </Button>
        )}
      </div>
    </fetcher.Form>
  );
}

export function SettingsForm({
  settings,
  scope,
}: {
  settings: SettingView[];
  scope: "global" | "library";
}) {
  const groups = [...new Set(settings.map((s) => s.group))];
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group}>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {GROUP_LABELS[group] ?? group}
          </h2>
          {settings
            .filter((s) => s.group === group)
            .map((s) => (
              <SettingRow key={s.key} setting={s} scope={scope} />
            ))}
        </section>
      ))}
    </div>
  );
}
