import { Toaster } from "@anki-cards/ui/components/sonner";
import { TooltipProvider } from "@anki-cards/ui/components/tooltip";
import { Layers, Settings } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { useLiveUpdates } from "~/lib/live";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
    isActive
      ? "bg-rose-gold/12 text-rose-gold ring-1 ring-rose-gold/30"
      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
  }`;

export default function Layout() {
  useLiveUpdates();
  return (
    <TooltipProvider>
      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-6 border-b border-rose-gold/10 bg-background/70 px-5 py-2.5 backdrop-blur-xl">
          <NavLink to="/" className="group flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full bg-linear-to-br from-champagne via-rose-gold to-rose-gold-deep text-primary-foreground shadow-[0_0_24px_-4px_var(--rose-gold)] transition-transform group-hover:rotate-[-8deg]">
              <Layers className="size-4" />
            </span>
            <span className="font-heading text-lg tracking-tight">
              Anki <em className="text-shimmer font-normal">Cards</em>
            </span>
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
      <Toaster theme="dark" />
    </TooltipProvider>
  );
}
