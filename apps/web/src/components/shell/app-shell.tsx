"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { PlayerHost } from "@/components/player/player-host";
import { ShellBottomNav } from "@/components/shell/shell-bottom-nav";
import { ShellSidebar } from "@/components/shell/shell-sidebar";
import { ShellTopbar } from "@/components/shell/shell-topbar";
import { cn } from "@/lib/utils";

// Position the sidebar's desktop default before the browser paints (no visible
// resize of the content column). No-op on the server.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
  // Enable width animation only after the initial desktop-default open, so that
  // first open doesn't smoothly resize the content column (scaling the player).
  const [sidebarAnimate, setSidebarAnimate] = useState(false);
  const close = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  useIsoLayoutEffect(() => {
    setSidebarOpen(readDesktopSidebarDefault());
  }, []);
  useEffect(() => {
    setSidebarAnimate(true);
  }, []);

  return (
    <div className="ot-app-shell flex h-[100dvh] w-full overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <ShellSidebar
        open={sidebarOpen}
        onClose={close}
        isLoggedIn={isLoggedIn}
        animate={sidebarAnimate}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellTopbar
          sidebarOpen={sidebarOpen}
          onOpenMenu={toggleSidebar}
          topbarRight={topbarRight}
          hiddenOnMobile={isShortsRoute}
        />
        {/* Stable, relatively-positioned scroll container. PlayerHost lives
            inside it so the full-size player is position:absolute in content
            space — the browser scrolls it natively (no per-frame JS). */}
        <div
          className={cn(
            "relative min-h-0 flex-1",
            isShortsRoute
              ? "overflow-hidden"
              : "ot-app-scroll overflow-y-auto overflow-x-hidden",
          )}
        >
          {children}
          <PlayerHost />
        </div>
        <ShellBottomNav account={bottomNavAccount} />
      </div>
    </div>
  );
}
