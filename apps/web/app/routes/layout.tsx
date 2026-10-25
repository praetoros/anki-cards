import { Toaster } from "@anki-cards/ui/components/sonner";
import { TooltipProvider } from "@anki-cards/ui/components/tooltip";
import { Layers, Settings } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { useLiveUpdates } from "~/lib/live";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${isActive ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`;

export default function Layout() {
  useLiveUpdates();
  return (
    <TooltipProvider>
      <div className="flex min-h-svh flex-col">
        <header className="flex items-center gap-4 border-b px-4 py-2">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <Layers className="size-4" /> Anki Cards
          </NavLink>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>
              Libraries
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              <Settings className="size-3.5" /> Settings
            </NavLink>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">
          <Outlet />
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
