import { createLibrary, listLibraries } from "@anki-cards/core";
import { Button } from "@anki-cards/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@anki-cards/ui/components/card";
import { Input } from "@anki-cards/ui/components/input";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { Form, Link, redirect } from "react-router";

import { XddFace } from "~/components/xdd-face";
import { useActionToast } from "~/lib/action-toast";
import { useTheme } from "~/lib/theme";
import { SYSTEM_LIBRARY_ID } from "~/lib/providers.server";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "Libraries · Anki Cards" }];
}

export async function loader() {
  const { db } = await rt();
  return {
    libraries: (await listLibraries(db)).filter((l) => l.id !== SYSTEM_LIBRARY_ID),
  };
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
  useActionToast(actionData);
  const xdd = useTheme() === "xdd";
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pt-14 pb-16">
      <header className="flex max-w-2xl animate-rise flex-col gap-3">
        <span className="text-xs font-medium tracking-[0.25em] text-highlight/80 uppercase">
          Your study shelf
        </span>
        <h1 className="text-5xl leading-[1.05] font-light md:text-6xl">
          Every lecture, <em className="text-shimmer font-normal">beautifully</em> remembered.
        </h1>
        <p className="text-muted-foreground">
          A library holds the knowledge for one subject and becomes one deck tree in Anki.
        </p>
      </header>
      <div className="grid gap-8 md:grid-cols-[1fr_340px]">
        <section className="grid content-start gap-4 sm:grid-cols-2">
          {loaderData.libraries.length === 0 && (
            <div className="col-span-full grid place-items-center gap-2 rounded-2xl border border-dashed border-highlight/25 px-6 py-16 text-center">
              {xdd ? (
                <XddFace className="w-20 animate-handheld" />
              ) : (
                <Sparkles className="size-6 text-highlight" />
              )}
              <p className="font-heading text-xl">No libraries yet</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Create your first one to start turning lecture slides into cards.
              </p>
            </div>
          )}
          {loaderData.libraries.map((lib, i) => (
            <Link
              key={lib.id}
              to={`/libraries/${lib.id}`}
              className="group animate-rise"
              style={{ animationDelay: `${80 + i * 60}ms` }}
            >
              <Card className="relative h-full overflow-hidden transition duration-300 group-hover:-translate-y-0.5 group-hover:ring-highlight/40 group-hover:shadow-[0_18px_40px_-20px_var(--highlight)]">
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-3 right-3 font-heading text-[7rem] leading-none text-highlight/8 italic transition-colors group-hover:text-highlight/15"
                >
                  {lib.name.charAt(0)}
                </span>
                <CardHeader>
                  <CardTitle className="text-xl">{lib.name}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {lib.description || "No description"}
                  </CardDescription>
                </CardHeader>
                <span className="mt-auto flex items-center gap-1 px-(--card-spacing) text-sm text-highlight/80 transition-colors group-hover:text-highlight">
                  Open{" "}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </Card>
            </Link>
          ))}
        </section>
        <aside className="animate-rise [animation-delay:120ms]">
          <Card className="sticky top-20 bg-linear-to-b from-accent/60 to-card ring-highlight/20">
            <CardHeader>
              <CardTitle className="text-xl">
                New <em className="text-highlight">library</em>
              </CardTitle>
              <CardDescription>One subject, one deck tree.</CardDescription>
            </CardHeader>
            <Form method="post" className="flex flex-col gap-3 px-(--card-spacing)">
              <Input name="name" placeholder="Name, e.g. Cardiology" required />
              <Textarea name="description" placeholder="Description (optional)" rows={2} />
              <Button type="submit" size="lg">
                <Plus /> Create library
              </Button>
            </Form>
          </Card>
        </aside>
      </div>
    </main>
  );
}
