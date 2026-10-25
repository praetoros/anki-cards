import { chatHistory, sendChatMessage } from "@anki-cards/core";
import { Bubble, BubbleContent } from "@anki-cards/ui/components/bubble";
import { Button } from "@anki-cards/ui/components/button";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { useEffect, useRef } from "react";
import { Form, useNavigation } from "react-router";

import { JobStream } from "~/components/job-stream";
import { JobStatusBadge } from "~/components/jobs-panel";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.chat";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { jobs: await chatHistory(db, params.libraryId) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    await sendChatMessage(db, params.libraryId, formString(form, "message"));
    return { ok: true };
  });
}

export default function Chat({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const form = useRef<HTMLFormElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = loaderData.jobs.length;

  useEffect(() => {
    if (navigation.state === "idle") form.current?.reset();
  }, [navigation.state]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [count]);

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        Ask about the library or give instructions that don&apos;t fit a single review item. Each
        message runs as a job with the same tools and approval rules; every change appears in
        History and can be reverted.
      </p>
      <div className="flex flex-1 flex-col gap-4">
        {loaderData.jobs.map((job) => (
          <div key={job.id} className="flex flex-col gap-2">
            <Bubble align="end" className="self-end">
              <BubbleContent className="text-sm whitespace-pre-wrap">
                {job.prompt.replace(/\n\n\(The user is looking at:[\s\S]*$/, "")}
              </BubbleContent>
            </Bubble>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <JobStatusBadge status={job.status} />
              {new Date(job.createdAt).toLocaleString()}
            </div>
            <div className="rounded-lg border p-2">
              <JobStream jobId={job.id} />
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <Form method="post" ref={form} className="sticky bottom-0 flex gap-2 bg-background py-2">
        <Textarea
          name="message"
          rows={2}
          placeholder="e.g. Which concepts have no cards yet?"
          required
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
              e.currentTarget.form?.requestSubmit();
          }}
        />
        <Button type="submit" disabled={navigation.state !== "idle"}>
          Send
        </Button>
      </Form>
      {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
    </main>
  );
}
