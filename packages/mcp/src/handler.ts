import { sessionForToken, type Runtime } from "@anki-cards/core";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import { buildServer } from "./server.ts";

function unauthorized(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" },
  });
}

/**
 * The app's MCP endpoint. Each request carries a session bearer token; the server instance for
 * that request exposes only the tools of the session's running job.
 */
export function createAnkiMcpHandler(getRuntime: () => Promise<Runtime>) {
  const handler = createMcpHandler(async (ctx) => {
    const runtime = await getRuntime();
    const found = ctx.authInfo ? await sessionForToken(runtime.db, ctx.authInfo.token) : undefined;
    if (!found) throw new Error("Invalid session token");
    return buildServer(runtime, found.session, found.job);
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const rejected =
        hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins());
      if (rejected) return rejected;
      const header = request.headers.get("authorization") ?? "";
      const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
      if (!token) return unauthorized("Missing bearer token");
      const runtime = await getRuntime();
      const found = await sessionForToken(runtime.db, token);
      if (!found) return unauthorized("Invalid or expired session token");
      return handler.fetch(request, {
        authInfo: { token, clientId: found.session.id, scopes: found.job ? [found.job.kind] : [] },
      });
    },
  };
}
