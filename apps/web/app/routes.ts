import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("mcp", "routes/mcp.ts"),
  route("events", "routes/events.ts"),
  route("api/jobs/:jobId", "routes/api.jobs.$jobId.ts"),
  route("media/:mediaId", "routes/media.$mediaId.ts"),
  route("exports/:exportId", "routes/exports.$exportId.ts"),
  route("api/sessions/:sessionId", "routes/api.sessions.$sessionId.ts"),
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("settings", "routes/settings.tsx"),
    route("libraries/:libraryId", "routes/library.tsx", [
      index("routes/library.overview.tsx"),
      route("sources", "routes/library.sources.tsx"),
      route("sources/:sourceId", "routes/library.source.tsx"),
      route("knowledge", "routes/library.knowledge.tsx"),
      route("objectives", "routes/library.objectives.tsx"),
      route("review", "routes/library.review.tsx"),
      route("cards", "routes/library.cards.tsx"),
      route("chat", "routes/library.chat.tsx"),
      route("export", "routes/library.export.tsx"),
      route("history", "routes/library.history.tsx"),
      route("settings", "routes/library.settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
