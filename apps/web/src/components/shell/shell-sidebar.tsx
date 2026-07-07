"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/shell/brand-logo";
import {
  activeForPath,
  SECONDARY_NAV,
  SIDEBAR_NAV,
} from "@/components/shell/nav-config";
import { SidebarSubscriptions } from "@/components/shell/sidebar-subscriptions";
import { cn } from "@/lib/utils";

const SHELL_SIDEBAR_WIDTH_PX = 228;

type ShellSidebarProps = {
  open: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  /** Animate width changes. Off for the initial desktop-default open so the
   *  content column doesn't visibly resize (scaling the watch player) on load. */
  animate?: boolean;
};

export function ShellSidebar({
  open,
  onClose,
  isLoggedIn,
  animate = true,
}: ShellSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      aria-hidden={!open}
      style={{ width: open ? SHELL_SIDEBAR_WIDTH_PX : 0 }}
      className={cn(
        "ot-shell-sidebar hidden h-full shrink-0 flex-col overflow-hidden bg-[hsl(var(--sidebar))] min-[901px]:flex",
        animate && "transition-[width,border-color] duration-200 ease-out",
        open ? "border-r border-[hsl(var(--border))]" : "border-r-0",
      )}
    >
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ width: SHELL_SIDEBAR_WIDTH_PX }}
      >
        <div className="ot-shell-sidebar-header flex min-w-0 shrink-0 items-center gap-1.5 bg-[hsl(var(--sidebar))] px-3 pb-4 pt-5">
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

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2.5 pb-4 pt-3">
          <nav className="flex flex-col gap-0.5">
            {SIDEBAR_NAV.map((n) => {
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

          <div className="mx-2.5 my-3.5 h-px bg-[hsl(var(--border))]" />

          <div className="flex flex-col gap-0.5">
            {SECONDARY_NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname.startsWith(n.href) ? "page" : undefined}
                className={cn(
                  "ot-shell-nav-link",
                  pathname.startsWith(n.href) && "ot-shell-nav-link--active",
                )}
              >
                <span className="inline-flex h-5 w-5 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                  {n.icon}
                </span>
                <span className="ot-shell-nav-label">{n.label}</span>
              </Link>
            ))}
          </div>

          {isLoggedIn ? (
            <>
              <div className="mx-2.5 my-3.5 h-px bg-[hsl(var(--border))]" />
              <div>
                <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Following
                </div>
                <div className="flex flex-col gap-0.5">
                  <SidebarSubscriptions enabled={isLoggedIn} />
                </div>
              </div>
            </>
          ) : null}

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
