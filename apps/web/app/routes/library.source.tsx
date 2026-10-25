import { coverageForSource, resolveSource, sourceUnits } from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@anki-cards/ui/components/card";
import { Link } from "react-router";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.source";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const source = await resolveSource(db, params.libraryId, params.sourceId);
  const units = await sourceUnits(db, source.id);
  const coverage = await coverageForSource(db, source.id);
  return { source, units, coverage: coverage.map((c) => c.entry) };
}

function locationLabel(loc: { page?: number; slide?: number; label?: string }) {
  if (loc.slide) return `Slide ${loc.slide}`;
  if (loc.page) return `Page ${loc.page}`;
  return loc.label ?? "";
}

export default function SourceDetail({ loaderData }: Route.ComponentProps) {
  const { source, units, coverage } = loaderData;
  return (
    <main className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link to=".." relative="path" className="text-sm text-muted-foreground hover:underline">
          Sources
        </Link>
        <span className="text-muted-foreground">/</span>
        <h2 className="font-semibold">
          {source.displayId} {source.title}
        </h2>
        <Badge variant="outline">{source.extractionStatus}</Badge>
      </div>
      {source.limitations.length > 0 && (
        <ul className="list-disc rounded-md bg-muted p-3 pl-8 text-sm">
          {source.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {units.map((unit) => {
        const entries = coverage.filter((c) => c.sourceUnitId === unit.id);
        return (
          <Card key={unit.id} size="sm" id={unit.displayId}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">{unit.displayId}</span>
                <span>{locationLabel(unit.location)}</span>
                <Badge variant="outline">{unit.unitType}</Badge>
                {entries.map((e) => (
                  <Badge
                    key={e.id}
                    variant={e.outcome === "requires_review" ? "destructive" : "secondary"}
                  >
                    {e.outcome.replaceAll("_", " ")}
                  </Badge>
                ))}
                {entries.length === 0 && <Badge variant="outline">not yet covered</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-[minmax(0,320px)_1fr]">
              <div className="flex flex-col gap-2">
                {unit.renderMediaId && (
                  <img
                    src={`/media/${unit.renderMediaId}`}
                    alt={`Render of ${locationLabel(unit.location)}`}
                    className="w-full rounded border"
                    loading="lazy"
                  />
                )}
                {unit.mediaIds.map((id) => (
                  <img
                    key={id}
                    src={`/media/${id}`}
                    alt=""
                    className="max-h-48 rounded border object-contain"
                    loading="lazy"
                  />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <pre className="text-xs whitespace-pre-wrap">{unit.text || "(no text)"}</pre>
                {entries.map(
                  (e) =>
                    e.explanation && (
                      <p key={e.id} className="text-xs text-muted-foreground">
                        {e.explanation}
                      </p>
                    ),
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </main>
  );
}
