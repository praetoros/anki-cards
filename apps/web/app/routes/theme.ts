import { data } from "react-router";

import { parseTheme } from "~/lib/theme";
import { themeCookieHeader } from "~/lib/theme.server";
import type { Route } from "./+types/theme";

export async function action({ request }: Route.ActionArgs) {
  const theme = parseTheme((await request.formData()).get("theme"));
  return data({ theme }, { headers: { "Set-Cookie": await themeCookieHeader(theme) } });
}
