"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { WatchMiniPlayer } from "@/components/player/watch-mini-player";
import { ShellBottomNav } from "@/components/shell/shell-bottom-nav";
import { ShellSidebar } from "@/components/shell/shell-sidebar";
import { ShellTopbar } from "@/components/shell/shell-topbar";

type AppShellProps = {
  children: ReactNode;
  topbarRight: ReactNode;
  bottomNavAccount: ReactNode;
  isLoggedIn: boolean;
};

function readDesktopSidebarDefault(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 901px)").matches;
}

export function AppShell({
  children,
  topbarRight,
  bottomNavAccount,
  isLoggedIn,
}: AppShellProps) {
  const pathname = usePathname();
  const isShortsRoute =
    pathname === "/shorts" || pathname.startsWith("/shorts?");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const close = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  useEffect(() => {
    setSidebarOpen(readDesktopSidebarDefault());
  }, []);

  return (
    <div className="ot-app-shell flex h-[100dvh] w-full overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <ShellSidebar
        open={sidebarOpen}
        onClose={close}
        isLoggedIn={isLoggedIn}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellTopbar
          sidebarOpen={sidebarOpen}
          onOpenMenu={toggleSidebar}
          topbarRight={topbarRight}
          hiddenOnMobile={isShortsRoute}
        />
        <div
          className={
            isShortsRoute
              ? "relative min-h-0 flex-1 overflow-hidden"
              : "ot-app-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          }
        >
          {children}
        </div>
        <ShellBottomNav account={bottomNavAccount} />
      </div>
      <WatchMiniPlayer isLoggedIn={isLoggedIn} />
    </div>
  );
}
