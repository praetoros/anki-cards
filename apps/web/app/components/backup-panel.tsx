import { Button } from "@anki-cards/ui/components/button";
import { useFetcher } from "react-router";

import { formatDateTime } from "~/lib/format";

export interface BackupView {
  id: string;
  path: string;
  reason: string;
  createdAt: string;
}

export function BackupPanel({ backups }: { backups: BackupView[] }) {
  const fetcher = useFetcher<{ error?: string; message?: string }>();
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Backups
        </h2>
        <fetcher.Form method="post">
          <Button type="submit" size="sm" variant="outline" name="intent" value="backup">
            {fetcher.state === "idle" ? "Back up now" : "Backing up…"}
          </Button>
        </fetcher.Form>
      </div>
      <p className="text-xs text-muted-foreground">
        Backups go to the backup folder below (for example a synced Google Drive folder), or
        data/backups when it is not set. A backup is also made before each database migration.
      </p>
      {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
      {fetcher.data?.message && <p className="text-sm">{fetcher.data.message}</p>}
      <ul className="text-xs">
        {backups.slice(0, 10).map((b) => (
          <li key={b.id}>
            {formatDateTime(b.createdAt)} · {b.reason} ·{" "}
            <code className="text-muted-foreground">{b.path}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}
