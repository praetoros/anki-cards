import { getLibrary } from "@anki-cards/core";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.overview";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { library: await getLibrary(db, params.libraryId) };
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  return (
    <main className="flex flex-col gap-2 p-6">
      <p className="text-sm text-muted-foreground">
        {loaderData.library.description || "No description."}
      </p>
    </main>
  );
}
