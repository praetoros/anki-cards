import { useFetchers, useRouteLoaderData } from "react-router";

import type { loader } from "~/root";

export const THEMES = ["midnight", "xdd"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_ACTION = "/theme";

export function parseTheme(value: unknown): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "midnight";
}

/** The current theme. A toggle that is still submitting wins, so the switch is instant. */
export function useTheme(): Theme {
  const pending = useFetchers().find((f) => f.formAction === THEME_ACTION)?.formData;
  const data = useRouteLoaderData<typeof loader>("root");
  return pending ? parseTheme(pending.get("theme")) : (data?.theme ?? "midnight");
}
