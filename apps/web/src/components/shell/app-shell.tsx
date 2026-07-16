"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { PlayerHost } from "@/components/player/player-host";
import { ShellBottomNav } from "@/components/shell/shell-bottom-nav";
import { ShellSidebar } from "@/components/shell/shell-sidebar";
import { ShellTopbar } from "@/components/shell/shell-topbar";
import { cn } from "@/lib/utils";

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
  // Start open (the desktop default) so the SSR HTML paints at the final content
  // width. Otherwise the server renders the sidebar collapsed, the browser
  // paints the content column full-width, then the client opens the sidebar and
  // the column (and the watch player/poster inside it) snaps ~¾×228px narrower
  // on load. The sidebar is display:none below 901px, so an initial `open` is a
  // no-op on mobile; the effect reconciles the real value after mount.
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
        {/* Shorts is a full-bleed, chrome-free experience on phones (the topbar
            is hidden too) — drop the bottom tab bar so the feed uses the whole
            height; the in-feed exit cross navigates back. */}
        {isShortsRoute ? null : <ShellBottomNav account={bottomNavAccount} />}
      </div>
    </div>
  );
}
