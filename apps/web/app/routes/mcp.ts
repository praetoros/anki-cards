import { getRuntime } from "@anki-cards/core";
import { createAnkiMcpHandler } from "@anki-cards/mcp";

import type { Route } from "./+types/mcp";

const handler = createAnkiMcpHandler(getRuntime);

export function loader({ request }: Route.LoaderArgs) {
  return handler.fetch(request);
}

export function action({ request }: Route.ActionArgs) {
  return handler.fetch(request);
}
