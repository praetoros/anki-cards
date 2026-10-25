import { providerStatuses, type ProviderId } from "@anki-cards/core";

import { ProviderPanel } from "~/components/provider-panel";
import { SettingsForm } from "~/components/settings-form";
import { checkAllProviders, startProviderTest } from "~/lib/providers.server";
import { formString, handle, rt } from "~/lib/runtime.server";
import { saveSettingFromForm, settingViews } from "~/lib/settings.server";
import type { Route } from "./+types/settings";

export function meta() {
  return [{ title: "Settings · Anki Cards" }];
}

export async function loader() {
  const { db, paths } = await rt();
  return {
    settings: await settingViews(db, null),
    providers: await providerStatuses(db),
    dataDir: paths.data,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const intent = formString(form, "intent");
    if (intent === "check-providers") {
      await checkAllProviders(db);
      return { ok: true, message: "Checked" };
    }
    if (intent === "test-provider") {
      const job = await startProviderTest(db, formString(form, "provider") as ProviderId);
      return { ok: true, message: "Test started", jobId: job.id };
    }
    return saveSettingFromForm(db, form, null);
  });
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Global defaults. Libraries can override most of these. Data folder:{" "}
          <code>{loaderData.dataDir}</code>
        </p>
      </div>
      <ProviderPanel providers={loaderData.providers} />
      <SettingsForm settings={loaderData.settings} scope="global" />
    </main>
  );
}
