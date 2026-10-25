import { Toaster } from "@anki-cards/ui/components/sonner";
import { TooltipProvider } from "@anki-cards/ui/components/tooltip";
import { Label } from "@anki-cards/ui/components/label";
import { Switch } from "@anki-cards/ui/components/switch";
import { Layers, Settings } from "lucide-react";
import { NavLink, Outlet, useFetcher } from "react-router";

import { XddBackdrop, XddFace } from "~/components/xdd-face";
import { useLiveUpdates } from "~/lib/live";
import { THEME_ACTION, useTheme } from "~/lib/theme";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
    isActive
      ? "bg-highlight/12 text-highlight ring-1 ring-highlight/30"
      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
  }`;

function ThemeToggle() {
  const fetcher = useFetcher();
  const xdd = useTheme() === "xdd";
  return (
    <Label className="ml-auto cursor-pointer text-muted-foreground">
      <Switch
        size="sm"
        checked={xdd}
        onCheckedChange={(checked) =>
          fetcher.submit(
            { theme: checked ? "xdd" : "midnight" },
            { method: "post", action: THEME_ACTION },
          )
        }
      />
      xdd
    </Label>
  );
}

export default function Layout() {
  useLiveUpdates();
  const xdd = useTheme() === "xdd";
  return (
    <TooltipProvider>
      {xdd && (
        <XddBackdrop className="pointer-events-none fixed -right-16 -bottom-16 -z-10 w-[48rem] max-w-none animate-handheld opacity-35 blur-[2px]" />
      )}
      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-6 border-b border-highlight/10 bg-background/70 px-5 py-2.5 backdrop-blur-xl">
          <NavLink to="/" className="group flex items-center gap-2.5">
            {xdd ? (
              <span className="grid size-8 place-items-center overflow-hidden rounded-full bg-background shadow-[0_0_24px_-4px_var(--highlight)] ring-1 ring-highlight/30 transition-transform group-hover:rotate-[-8deg]">
                <XddFace className="size-10 max-w-none" />
              </span>
            ) : (
              <span className="grid size-8 place-items-center rounded-full bg-linear-to-br from-highlight-pale via-highlight to-highlight-deep text-primary-foreground shadow-[0_0_24px_-4px_var(--highlight)] transition-transform group-hover:rotate-[-8deg]">
                <Layers className="size-4" />
              </span>
            )}
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
          <ThemeToggle />
        </header>
        <div className="flex flex-1 flex-col">
          <Outlet />
        </div>
      </div>
      <Toaster theme="dark" />
    </TooltipProvider>
  );
}
