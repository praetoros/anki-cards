import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("mcp", "routes/mcp.ts"),
  route("events", "routes/events.ts"),
  route("api/jobs/:jobId", "routes/api.jobs.$jobId.ts"),
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),
    route("settings", "routes/settings.tsx"),
    route("libraries/:libraryId", "routes/library.tsx", [
      index("routes/library.overview.tsx"),
      route("settings", "routes/library.settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
