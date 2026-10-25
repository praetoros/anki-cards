import type { TSessionS } from "@anki-cards/core";
import { Button } from "@anki-cards/ui/components/button";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { useState } from "react";
import { useFetcher } from "react-router";

export interface SummaryView {
  id: string;
  body: string;
  edited: boolean;
}

export function SessionActions({
  session,
  summary,
}: {
  session: TSessionS;
  summary: SummaryView | null;
}) {
  const fetcher = useFetcher<{ error?: string; message?: string }>();
  const [editing, setEditing] = useState(false);
  const busy = fetcher.state !== "idle" || session.status === "running";
  return (
    <div className="flex flex-col gap-1">
      <fetcher.Form
        method="post"
        action={`/api/sessions/${session.id}`}
        className="flex flex-wrap gap-1"
      >
        <Button
          type="submit"
          size="xs"
          variant="outline"
          name="intent"
          value="compact"
          disabled={busy}
        >
          Compact
        </Button>
        <Button type="submit" size="xs" variant="ghost" name="intent" value="new" disabled={busy}>
          New session
        </Button>
        <Button
          type="submit"
          size="xs"
          variant="ghost"
          name="intent"
          value="archive"
          disabled={busy}
        >
          Archive
        </Button>
      </fetcher.Form>
      {summary && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-left text-xs text-muted-foreground hover:underline"
        >
          Starts from a summary{summary.edited ? " (edited)" : ""}. View or edit
        </button>
      )}
      {summary && editing && (
        <fetcher.Form
          method="post"
          action={`/api/sessions/${session.id}`}
          className="flex flex-col gap-1"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="summaryId" value={summary.id} />
          <Textarea name="body" defaultValue={summary.body} rows={6} className="text-xs" />
          <div className="flex gap-1">
            <Button type="submit" size="xs" name="intent" value="edit-summary">
              Save
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Close
            </Button>
          </div>
        </fetcher.Form>
      )}
      {fetcher.data?.error && (
        <span className="text-xs text-destructive">{fetcher.data.error}</span>
      )}
    </div>
  );
}
