import { getJob, getRunner, jobEvents } from "@anki-cards/core";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/api.jobs.$jobId";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { job: await getJob(db, params.jobId), events: await jobEvents(db, params.jobId) };
}

export async function action({ params, request }: Route.ActionArgs) {
  const form = await request.formData();
  const { db } = await rt();
  if (form.get("intent") === "cancel") await getRunner()?.cancel(params.jobId);
  return { job: await getJob(db, params.jobId) };
}
