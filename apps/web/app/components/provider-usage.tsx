import type { ProviderUsage } from "@anki-cards/core";
import { Progress } from "@anki-cards/ui/components/progress";

import { formatDateTime } from "~/lib/format";

function windowLabel(minutes: number | null) {
  if (minutes === null) return "usage limit";
  if (minutes >= 10080) return "weekly limit";
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}-day limit`;
  return `${Math.round(minutes / 60)}-hour limit`;
}

export function ProviderUsageMeter({ label, usage }: { label: string; usage: ProviderUsage }) {
  const left = Math.max(0, Math.round(100 - usage.usedPercent));
  const credits = usage.credits === null ? null : Number(usage.credits);
  return (
    <div
      className="flex flex-col gap-1 text-xs text-muted-foreground"
      title={`Reported ${formatDateTime(usage.updatedAt)}, after the last job.`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0">
          {label}: {left}% of {windowLabel(usage.windowMinutes)} left
        </span>
        <Progress
          value={usage.usedPercent}
          className={`flex-1 ${left <= 10 ? "[&_[data-slot=progress-indicator]]:bg-destructive" : ""}`}
        />
      </div>
      <span>
        {usage.resetsAt && <>Resets {formatDateTime(usage.resetsAt)}</>}
        {credits !== null && Number.isFinite(credits) && (
          <>
            {usage.resetsAt && " · "}
            {Math.floor(credits).toLocaleString("en")} credits
          </>
        )}
      </span>
    </div>
  );
}
