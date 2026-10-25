import { Button } from "@anki-cards/ui/components/button";
import { Input } from "@anki-cards/ui/components/input";
import { useFetcher } from "react-router";

export interface TrustedSourceView {
  id: string;
  domain: string;
  note: string;
  libraryId: string | null;
}

export function TrustedSources({
  sources,
  scope,
}: {
  sources: TrustedSourceView[];
  scope: "global" | "library";
}) {
  const fetcher = useFetcher<{ error?: string }>();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Trusted sources
      </h2>
      <p className="text-xs text-muted-foreground">
        Enrichment prefers these. Other sources are allowed but each cited fact is flagged for you
        to approve.
        {scope === "library" && " Global entries apply here too."}
      </p>
      <ul className="flex flex-wrap gap-2 text-sm">
        {sources.map((s) => (
          <li key={s.id} className="flex items-center gap-1 rounded-md border px-2 py-0.5">
            {s.domain}
            {scope === "library" && s.libraryId === null ? (
              <span className="text-xs text-muted-foreground">(global)</span>
            ) : (
              <fetcher.Form method="post">
                <input type="hidden" name="trustedId" value={s.id} />
                <Button
                  type="submit"
                  size="xs"
                  variant="ghost"
                  name="intent"
                  value="remove-trusted"
                >
                  ×
                </Button>
              </fetcher.Form>
            )}
          </li>
        ))}
      </ul>
      <fetcher.Form method="post" className="flex gap-2">
        <Input name="domain" placeholder="e.g. teachmeanatomy.info" className="max-w-xs" />
        <Button type="submit" size="sm" variant="outline" name="intent" value="add-trusted">
          Add
        </Button>
        {fetcher.data?.error && (
          <span className="text-sm text-destructive">{fetcher.data.error}</span>
        )}
      </fetcher.Form>
    </section>
  );
}
