import { objectivesWithCoverage } from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@anki-cards/ui/components/table";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.objectives";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { objectives: await objectivesWithCoverage(db, params.libraryId) };
}

const VARIANT = {
  covered: "secondary",
  partial: "default",
  gap: "destructive",
  uncertain: "outline",
} as const;

const WORST = ["gap", "uncertain", "partial", "covered"] as const;

function worst(states: (keyof typeof VARIANT)[]) {
  return WORST.find((w) => states.includes(w)) ?? null;
}

export default function Objectives({ loaderData }: Route.ComponentProps) {
  return (
    <main className="p-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Objective</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead>Source coverage</TableHead>
            <TableHead>Library coverage</TableHead>
            <TableHead>Mapped to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loaderData.objectives.map((o) => {
            const source = worst(o.mappings.map((m) => m.sourceCoverage));
            const library = worst(o.mappings.map((m) => m.libraryCoverage));
            return (
              <TableRow key={o.id}>
                <TableCell className="font-mono text-xs">{o.displayId}</TableCell>
                <TableCell className="max-w-md whitespace-normal">{o.text}</TableCell>
                <TableCell>
                  <Badge variant={o.origin === "explicit" ? "secondary" : "outline"}>
                    {o.origin}
                  </Badge>
                </TableCell>
                <TableCell>
                  {source ? <Badge variant={VARIANT[source]}>{source}</Badge> : "—"}
                </TableCell>
                <TableCell>
                  {library ? <Badge variant={VARIANT[library]}>{library}</Badge> : "—"}
                </TableCell>
                <TableCell className="max-w-sm text-xs whitespace-normal text-muted-foreground">
                  {o.mappings.map((m) => m.rationale).join(" · ")}
                </TableCell>
              </TableRow>
            );
          })}
          {loaderData.objectives.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No learning objectives yet. Synthesis records them from the sources.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </main>
  );
}
