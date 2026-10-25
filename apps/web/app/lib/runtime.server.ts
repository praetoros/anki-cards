import { DomainError, getRuntime } from "@anki-cards/core";
import { data } from "react-router";

export async function rt() {
  return getRuntime();
}

export interface ActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Runs an action body and turns expected domain failures into a 400 with a readable message. */
export async function handle<T extends ActionResult>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DomainError)
      return data<ActionResult>({ error: error.message }, { status: 400 });
    throw error;
  }
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
