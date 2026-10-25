import { getLibrary } from "@anki-cards/core";
import { NavLink, Outlet } from "react-router";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { library: await getLibrary(db, params.libraryId) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.library.name ?? "Library"} · Anki Cards` }];
}

const TABS = [
  { to: "", label: "Overview", end: true },
  { to: "settings", label: "Settings" },
];

export default function Library({ loaderData }: Route.ComponentProps) {
  const { library } = loaderData;
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <h1 className="font-semibold">{library.name}</h1>
        <nav className="flex flex-wrap gap-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `rounded-md px-2 py-1 text-sm ${isActive ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex flex-1">
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
