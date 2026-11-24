"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { useSettingsPatch } from "@/components/settings/use-settings-patch";
import { BrandLogo } from "@/components/shell/brand-logo";
import { activeForPath, navItemByKey } from "@/components/shell/nav-config";
import { SidebarFollowing } from "@/components/shell/sidebar-subscriptions";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import {
  DEFAULT_SIDEBAR_NAV,
  resolveSidebarEntries,
  sidebarSlots,
} from "@/lib/sidebar-nav";
import { cn } from "@/lib/utils";

const SHELL_SIDEBAR_WIDTH_PX = 228;

type ShellSidebarProps = {
  open: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
};

export function ShellSidebar({ open, onClose, isLoggedIn }: ShellSidebarProps) {
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollFade(scrollRef);
  const { settings, save } = useSettingsPatch({ enabled: isLoggedIn });
  const sidebarNav = settings?.sidebarNav ?? DEFAULT_SIDEBAR_NAV;
  const slots = sidebarSlots(resolveSidebarEntries(sidebarNav.items), {
    signedIn: isLoggedIn,
  });

  return (
    <aside
      aria-hidden={!open}
      style={{ width: open ? SHELL_SIDEBAR_WIDTH_PX : 0 }}
      className={cn(
        "ot-shell-sidebar hidden h-full shrink-0 flex-col overflow-hidden bg-[hsl(var(--sidebar))] transition-[width,border-color] duration-200 ease-out min-[901px]:flex",
        open ? "border-r border-[hsl(var(--border))]" : "border-r-0",
      )}
    >
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ width: SHELL_SIDEBAR_WIDTH_PX }}
      >
        <div className="ot-shell-sidebar-header flex min-w-0 shrink-0 items-center gap-1.5 bg-[hsl(var(--sidebar))] px-3 pb-4 pt-[calc(1.25rem_+_env(safe-area-inset-top))]">
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-shell)] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            aria-label="Close menu"
            onClick={onClose}
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
          <BrandLogo compact tile className="min-w-0 shrink" />
        </div>

        <div
          ref={scrollRef}
          className="ot-scroll-fade ot-hide-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2.5 pb-4 pt-3"
        >
          <nav className="flex flex-col gap-0.5" aria-label="Main">
            {slots.map((slot, i) => {
              if (slot.kind === "divider") {
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity; their position is the key.
                    key={`divider-${i}`}
                    className="mx-2.5 my-3 h-px shrink-0 bg-[hsl(var(--border))]"
                  />
                );
              }
              if (slot.kind === "following") {
                return (
                  <SidebarFollowing
                    key="following"
                    collapsed={sidebarNav.followingCollapsed}
                    onToggle={() =>
                      void save({
                        sidebarNav: {
                          ...sidebarNav,
                          followingCollapsed: !sidebarNav.followingCollapsed,
                        },
                      })
                    }
                  />
                );
              }
              const n = navItemByKey(slot.key);
              if (!n) return null;
              const active = activeForPath(pathname, n.href, n.key);
              return (
                <Link
                  key={n.key}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "ot-shell-nav-link",
                    active && "ot-shell-nav-link--active",
                  )}
                >
                  <span className="inline-flex h-5 w-5 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                    {active ? (n.iconActive ?? n.icon) : n.icon}
                  </span>
                  <span className="ot-shell-nav-label">{n.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-[hsl(var(--border))] px-3 pb-2 pt-4 text-xs text-[hsl(var(--muted-foreground))]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
              <span>Feed from your instance</span>
            </div>
            <div className="ot-mono-data mt-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
              owntube
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
