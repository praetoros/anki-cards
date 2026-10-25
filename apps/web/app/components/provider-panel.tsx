import type { ProviderStatus } from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@anki-cards/ui/components/card";
import { useState } from "react";
import { useFetcher } from "react-router";

import { JobStream } from "./job-stream";

function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const fetcher = useFetcher<{ jobId?: string; error?: string; message?: string }>();
  const [showTest, setShowTest] = useState(false);
  const jobId = fetcher.data?.jobId;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {provider.label}
          <Badge variant={provider.ok ? "secondary" : "destructive"}>
            {provider.ok ? "Ready" : "Not ready"}
          </Badge>
          {provider.testOk !== null && (
            <Badge variant={provider.testOk ? "outline" : "destructive"}>
              Test {provider.testOk ? "passed" : "failed"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <dl className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-1">
          <dt className="text-muted-foreground">Path</dt>
          <dd className="truncate font-mono text-xs">{provider.path ?? "not found"}</dd>
          <dt className="text-muted-foreground">Version</dt>
          <dd>
            {provider.version ?? "unknown"}{" "}
            <span className="text-muted-foreground">(needs ≥ {provider.minVersion})</span>
          </dd>
          <dt className="text-muted-foreground">Signed in</dt>
          <dd>{provider.loggedIn ? "yes" : "no"}</dd>
        </dl>
        {!provider.ok && (
          <div className="rounded-md bg-muted p-2">
            <p>{provider.message}</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {provider.help.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        )}
        {provider.testMessage && (
          <p className="text-xs text-muted-foreground">Last test: {provider.testMessage}</p>
        )}
        <fetcher.Form method="post" className="flex gap-2" onSubmit={() => setShowTest(true)}>
          <input type="hidden" name="provider" value={provider.provider} />
          <Button
            type="submit"
            size="sm"
            name="intent"
            value="test-provider"
            disabled={!provider.ok}
          >
            Test (uses a little quota)
          </Button>
        </fetcher.Form>
        {fetcher.data?.error && <p className="text-destructive">{fetcher.data.error}</p>}
        {showTest && jobId && (
          <div className="max-h-80 overflow-auto rounded-md border p-2">
            <JobStream jobId={jobId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ProviderPanel({ providers }: { providers: ProviderStatus[] }) {
  const fetcher = useFetcher();
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          AI providers
        </h2>
        <fetcher.Form method="post">
          <Button type="submit" size="sm" variant="outline" name="intent" value="check-providers">
            {fetcher.state === "idle" ? "Check again" : "Checking…"}
          </Button>
        </fetcher.Form>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => (
          <ProviderCard key={p.provider} provider={p} />
        ))}
      </div>
    </section>
  );
}
