import { exportLibraryArchive } from "@anki-cards/core";
import { Button } from "@anki-cards/ui/components/button";
import { useFetcher } from "react-router";

import { SettingsForm } from "~/components/settings-form";
import { handle, rt } from "~/lib/runtime.server";
import { saveSettingFromForm, settingViews } from "~/lib/settings.server";
import type { Route } from "./+types/library.settings";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { settings: await settingViews(db, params.libraryId) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db, paths } = await rt();
    if (form.get("intent") === "export-library") {
      const path = await exportLibraryArchive(db, paths, params.libraryId);
      return { ok: true, message: `Exported to ${path}` };
    }
    return saveSettingFromForm(db, form, params.libraryId);
  });
}

function ExportLibrary() {
  const fetcher = useFetcher<{ error?: string; message?: string }>();
  return (
    <fetcher.Form method="post" className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="outline" name="intent" value="export-library">
        Export library archive
      </Button>
      <span className="text-xs text-muted-foreground">
        {fetcher.data?.message ??
          fetcher.data?.error ??
          "A zip of this library with its files, to the backup folder."}
      </span>
    </fetcher.Form>
  );
}

export default function LibrarySettings({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <p className="text-sm text-muted-foreground">
        Settings saved here override the global value for this library only.
      </p>
      <ExportLibrary />
      <SettingsForm settings={loaderData.settings} scope="library" />
    </main>
  );
}
