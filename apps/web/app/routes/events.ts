import {
  bus,
  getRuntime,
  type ChangeEvent,
  type JobEventMessage,
  type NoticeEvent,
} from "@anki-cards/core";

import type { Route } from "./+types/events";

/** Server-sent events: library changes, job events and notices for the open UI. */
export async function loader({ request }: Route.LoaderArgs) {
  await getRuntime();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const onChange = (e: ChangeEvent) => send("change", e);
      const onJob = (e: JobEventMessage) => send("job", e);
      const onNotice = (e: NoticeEvent) => send("notice", e);
      bus.on("change", onChange);
      bus.on("job", onJob);
      bus.on("notice", onNotice);
      const heartbeat = setInterval(() => send("ping", {}), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        bus.off("change", onChange);
        bus.off("job", onJob);
        bus.off("notice", onNotice);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      send("ready", {});
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
