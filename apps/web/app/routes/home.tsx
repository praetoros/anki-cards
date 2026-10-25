import { createLibrary, listLibraries } from "@anki-cards/core";
import { Button } from "@anki-cards/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@anki-cards/ui/components/card";
import { Input } from "@anki-cards/ui/components/input";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { Form, Link, redirect } from "react-router";

import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "Libraries · Anki Cards" }];
}

export async function loader() {
  const { db } = await rt();
  return { libraries: await listLibraries(db) };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const lib = await createLibrary(db, {
      name: formString(form, "name"),
      description: formString(form, "description"),
    });
    throw redirect(`/libraries/${lib.id}`);
  });
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6 md:grid-cols-[1fr_320px]">
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Libraries</h1>
        {loaderData.libraries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No libraries yet. A library holds the knowledge for one subject and becomes one deck
            tree in Anki.
          </p>
        )}
        {loaderData.libraries.map((lib) => (
          <Link key={lib.id} to={`/libraries/${lib.id}`}>
            <Card size="sm" className="hover:bg-muted/50">
              <CardHeader>
                <CardTitle>{lib.name}</CardTitle>
                {lib.description && <CardDescription>{lib.description}</CardDescription>}
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>
      <aside>
        <Card size="sm">
          <CardHeader>
            <CardTitle>New library</CardTitle>
          </CardHeader>
          <Form method="post" className="flex flex-col gap-2 px-(--card-spacing)">
            <Input name="name" placeholder="Name, e.g. Cardiology" required />
            <Textarea name="description" placeholder="Description (optional)" rows={2} />
            {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
            <Button type="submit">Create</Button>
          </Form>
        </Card>
      </aside>
    </main>
  );
}
