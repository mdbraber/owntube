"use client";

import type { ReactNode } from "react";
import { BrandLogo } from "@/components/shell/brand-logo";
import { TopbarBackButton } from "@/components/shell/topbar-back-button";
import { TopbarSearch } from "@/components/shell/topbar-search";
import { cn } from "@/lib/utils";

type ShellTopbarProps = {
  sidebarOpen: boolean;
  onOpenMenu: () => void;
  onLogoClick?: () => void;
  topbarRight: ReactNode;
  hiddenOnMobile?: boolean;
};

export function ShellTopbar({
  sidebarOpen,
  onOpenMenu,
  onLogoClick,
  topbarRight,
  hiddenOnMobile = false,
}: ShellTopbarProps) {
  return (
    <header
      className={cn(
        "ot-shell-topbar sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)_/_0.88)] px-3 pb-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] backdrop-blur-xl backdrop-saturate-150 md:gap-3 md:px-4 dark:bg-[hsl(var(--background)_/_0.78)]",
        hiddenOnMobile && "hidden min-[901px]:flex",
      )}
    >
      {!sidebarOpen ? (
        <div className="flex shrink-0 items-center gap-2">
          <TopbarBackButton />
          <button
            type="button"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-shell)] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] min-[901px]:inline-flex"
            aria-label="Toggle menu"
            onClick={onOpenMenu}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <title>Menu</title>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="block">
            <BrandLogo compact tile onNavigate={onLogoClick} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 justify-center px-1 md:px-3">
        <TopbarSearch />
      </div>

      <div className="hidden shrink-0 items-center justify-end gap-1 min-[901px]:flex">
        {topbarRight}
      </div>
    </header>
  );
}
