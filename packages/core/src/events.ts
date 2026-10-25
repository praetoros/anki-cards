import { EventEmitter } from "node:events";

export interface ChangeEvent {
  libraryId: string | null;
  tables: string[];
  changesetId: string | null;
}

export interface JobEventMessage {
  jobId: string;
  sessionId: string;
  libraryId: string;
  type: string;
  data: Record<string, unknown>;
}

export interface NoticeEvent {
  level: "info" | "warning" | "error";
  title: string;
  message: string;
}

interface Events {
  change: [ChangeEvent];
  job: [JobEventMessage];
  notice: [NoticeEvent];
}

const globalKey = Symbol.for("anki-cards.events");
const store = globalThis as unknown as Record<symbol, EventEmitter<Events> | undefined>;

/** Process-wide bus feeding the SSE endpoint. Survives dev-server module reloads. */
export const bus: EventEmitter<Events> = (store[globalKey] ??= new EventEmitter<Events>());
bus.setMaxListeners(100);

export function emitChange(event: ChangeEvent) {
  bus.emit("change", event);
}

export function emitJobEvent(event: JobEventMessage) {
  bus.emit("job", event);
}

export function emitNotice(event: NoticeEvent) {
  bus.emit("notice", event);
}
