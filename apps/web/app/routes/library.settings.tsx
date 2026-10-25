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
    const { db } = await rt();
    return saveSettingFromForm(db, form, params.libraryId);
  });
}

export default function LibrarySettings({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <p className="text-sm text-muted-foreground">
        Settings saved here override the global value for this library only.
      </p>
      <SettingsForm settings={loaderData.settings} scope="library" />
    </main>
  );
}
