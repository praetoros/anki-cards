import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("mcp", "routes/mcp.ts"),
  route("events", "routes/events.ts"),
  route("api/jobs/:jobId", "routes/api.jobs.$jobId.ts"),
  route("media/:mediaId", "routes/media.$mediaId.ts"),
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("settings", "routes/settings.tsx"),
    route("libraries/:libraryId", "routes/library.tsx", [
      index("routes/library.overview.tsx"),
      route("sources", "routes/library.sources.tsx"),
      route("sources/:sourceId", "routes/library.source.tsx"),
      route("settings", "routes/library.settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
