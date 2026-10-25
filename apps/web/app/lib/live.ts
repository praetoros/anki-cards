import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";
import { toast } from "sonner";

export interface LiveJobEvent {
  jobId: string;
  sessionId: string;
  libraryId: string;
  type: string;
  data: Record<string, unknown>;
}

export const JOB_EVENT = "anki:job";

/**
 * Subscribes to /events once for the whole app: data changes revalidate the current routes,
 * job events are re-dispatched on window for job views, and notices become toasts.
 */
export function useLiveUpdates() {
  const revalidator = useRevalidator();
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/events");
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void revalidate.current(), 250);
    };
    source.addEventListener("change", schedule);
    source.addEventListener("job", (e) => {
      const detail = JSON.parse((e as MessageEvent<string>).data) as LiveJobEvent;
      window.dispatchEvent(new CustomEvent<LiveJobEvent>(JOB_EVENT, { detail }));
      if (detail.type === "job_failed") {
        toast.error("A job failed", { description: JSON.stringify(detail.data["error"] ?? "") });
      }
    });
    source.addEventListener("notice", (e) => {
      const notice = JSON.parse((e as MessageEvent<string>).data) as {
        level: string;
        title: string;
        message: string;
      };
      const show =
        notice.level === "error" ? toast.error : notice.level === "warning" ? toast.warning : toast;
      show(notice.title, { description: notice.message });
    });
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, []);
}
