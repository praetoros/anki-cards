import { Badge } from "@anki-cards/ui/components/badge";
import { Bubble, BubbleContent } from "@anki-cards/ui/components/bubble";
import { Marker, MarkerContent } from "@anki-cards/ui/components/marker";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@anki-cards/ui/components/trace";
import { Brain, CheckCircle2, Globe, ListChecks, Terminal, Wrench, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";

import { JOB_EVENT, type LiveJobEvent } from "~/lib/live";

export interface StreamEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  status: string;
  result?: string;
}

type Item =
  | { kind: "message"; text: string; key: string }
  | { kind: "reasoning"; text: string; key: string }
  | { kind: "tool"; call: ToolCall; key: string }
  | { kind: "plan"; items: { text: string; done: boolean }[]; key: string }
  | { kind: "marker"; text: string; tone: "info" | "error"; key: string };

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v));

/** Folds raw job events into display items; tool results merge into their call. */
function toItems(events: StreamEvent[]): Item[] {
  const items: Item[] = [];
  const calls = new Map<string, ToolCall>();
  for (const e of events) {
    const key = String(e.id);
    const d = e.data;
    switch (e.type) {
      case "message":
        items.push({ kind: "message", text: str(d["text"]), key });
        break;
      case "summary":
        items.push({ kind: "message", text: str(d["text"]), key });
        break;
      case "reasoning":
        if (str(d["text"])) items.push({ kind: "reasoning", text: str(d["text"]), key });
        break;
      case "plan":
        items.push({
          kind: "plan",
          items: (d["items"] as { text: string; done: boolean }[]) ?? [],
          key,
        });
        break;
      case "tool_call": {
        const id = str(d["id"]);
        const existing = calls.get(id);
        if (existing) {
          existing.status = str(d["status"]);
          existing.result = str(d["result"]);
          if (str(d["name"])) existing.name = str(d["name"]);
        } else {
          const call: ToolCall = {
            id,
            name: str(d["name"]),
            args: d["args"],
            status: str(d["status"]),
            result: d["result"] === undefined ? undefined : str(d["result"]),
          };
          calls.set(id, call);
          items.push({ kind: "tool", call, key });
        }
        break;
      }
      case "command":
        items.push({
          kind: "tool",
          call: {
            id: key,
            name: `shell: ${str(d["command"])}`,
            args: undefined,
            status: str(d["status"]),
            result: str(d["output"]),
          },
          key,
        });
        break;
      case "web_search":
        items.push({
          kind: "tool",
          call: {
            id: key,
            name: `web search: ${str(d["query"])}`,
            args: undefined,
            status: "completed",
          },
          key,
        });
        break;
      case "started":
        items.push({
          kind: "marker",
          text: `Started (${str(d["provider"])}, attempt ${str(d["attempt"])})`,
          tone: "info",
          key,
        });
        break;
      case "ended":
        items.push({
          kind: "marker",
          text: `Ended: ${str(d["status"])}${d["error"] ? ` — ${str(d["error"])}` : ""}`,
          tone: d["status"] === "done" ? "info" : "error",
          key,
        });
        break;
      case "error":
        items.push({ kind: "marker", text: str(d["message"]), tone: "error", key });
        break;
      case "rate_limit":
        items.push({
          kind: "marker",
          text: `Rate limited${d["resetsAt"] ? ` until ${str(d["resetsAt"])}` : ""}`,
          tone: "error",
          key,
        });
        break;
      case "compacted":
        items.push({ kind: "marker", text: "Context compacted by the CLI", tone: "info", key });
        break;
      default:
        break;
    }
  }
  return items;
}

function ToolLine({ call }: { call: ToolCall }) {
  const failed = call.status === "failed";
  const running = call.status === "started";
  const Icon = call.name.startsWith("shell:")
    ? Terminal
    : call.name.startsWith("web search")
      ? Globe
      : Wrench;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={failed ? "error" : running ? "running" : undefined}>
          <TraceIcon>{failed ? <XCircle /> : running ? <Icon /> : <CheckCircle2 />}</TraceIcon>
          <TraceTitle>{call.name || "tool"}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="flex flex-col gap-1 text-xs">
          {call.args !== undefined && (
            <pre className="max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          )}
          {call.result && (
            <pre className="max-h-64 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">
              {call.result}
            </pre>
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function JobStream({ jobId }: { jobId: string }) {
  const fetcher = useFetcher<{
    events: StreamEvent[];
    job: {
      status: string;
      error: string | null;
      provider: string;
      model: string | null;
      usage: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        costUsd?: number;
        durationMs?: number;
      } | null;
    };
  }>();
  const usage = fetcher.data?.job.usage;
  const [live, setLive] = useState<StreamEvent[]>([]);

  useEffect(() => {
    setLive([]);
    void fetcher.load(`/api/jobs/${jobId}`);
    let seq = 1_000_000_000;
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<LiveJobEvent>).detail;
      if (detail.jobId !== jobId) return;
      setLive((prev) => [...prev, { id: seq++, type: detail.type, data: detail.data }]);
    };
    window.addEventListener(JOB_EVENT, onEvent);
    return () => window.removeEventListener(JOB_EVENT, onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const loaded = fetcher.data?.events ?? [];
  const lastLoaded = loaded.length;
  const items = useMemo(() => {
    const seen = new Set(loaded.map((e) => `${e.type}:${JSON.stringify(e.data)}`));
    const fresh = live.filter((e) => !seen.has(`${e.type}:${JSON.stringify(e.data)}`));
    return toItems([...loaded, ...fresh]);
  }, [loaded, live]);

  if (!fetcher.data && lastLoaded === 0)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      <Trace>
        {items.map((item) => {
          if (item.kind === "message") {
            return (
              <Bubble key={item.key} variant="muted" className="max-w-full">
                <BubbleContent className="text-sm whitespace-pre-wrap">{item.text}</BubbleContent>
              </Bubble>
            );
          }
          if (item.kind === "reasoning") {
            return (
              <TraceCollapsible key={item.key}>
                <TraceCollapsibleTrigger>
                  <TraceLine>
                    <TraceIcon>
                      <Brain />
                    </TraceIcon>
                    <TraceTitle>Reasoning</TraceTitle>
                  </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent>
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">{item.text}</p>
                </TraceCollapsibleContent>
              </TraceCollapsible>
            );
          }
          if (item.kind === "plan") {
            return (
              <div key={item.key} className="flex flex-col gap-1 rounded-md border p-2 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  <ListChecks className="size-4" /> Plan
                </span>
                {item.items.map((p, i) => (
                  <span key={i} className={p.done ? "text-muted-foreground line-through" : ""}>
                    {p.text}
                  </span>
                ))}
              </div>
            );
          }
          if (item.kind === "marker") {
            return (
              <Marker
                key={item.key}
                variant="separator"
                className={item.tone === "error" ? "text-destructive" : ""}
              >
                <MarkerContent>{item.text}</MarkerContent>
              </Marker>
            );
          }
          return <ToolLine key={item.key} call={item.call} />;
        })}
      </Trace>
      {fetcher.data?.job.error && <Badge variant="destructive">{fetcher.data.job.error}</Badge>}
      {usage && (
        <p className="text-xs text-muted-foreground">
          {fetcher.data?.job.provider}
          {fetcher.data?.job.model ? ` · ${fetcher.data.job.model}` : ""} ·{" "}
          {(usage.inputTokens + usage.cachedInputTokens).toLocaleString()} in (
          {usage.cachedInputTokens.toLocaleString()} cached) · {usage.outputTokens.toLocaleString()}{" "}
          out
          {usage.costUsd !== undefined && ` · ~$${usage.costUsd.toFixed(2)}`}
          {usage.durationMs !== undefined && ` · ${Math.round(usage.durationMs / 1000)} s`}
        </p>
      )}
    </div>
  );
}
