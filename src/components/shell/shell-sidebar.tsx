"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/shell/brand-logo";
import { SidebarSubscriptions } from "@/components/shell/sidebar-subscriptions";
import { cn } from "@/lib/utils";

type NavKey = "home" | "shorts" | "explore" | "subs" | "library" | "algorithm";

const NAV: { key: NavKey; href: string; label: string; icon: ReactNode }[] = [
  {
    key: "home",
    href: "/",
    label: "Home",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Home</title>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    ),
  },
  {
    key: "shorts",
    href: "/shorts",
    label: "Shorts",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Shorts</title>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M10 8v8l5-4-5-4z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: "explore",
    href: "/trending",
    label: "Explore",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Explore</title>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16 8 14 14 8 16 10 10 16 8" />
      </svg>
    ),
  },
  {
    key: "subs",
    href: "/subscriptions",
    label: "Subscriptions",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Subscriptions</title>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: "library",
    href: "/history",
    label: "History",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>History</title>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    key: "algorithm",
    href: "/dashboard",
    label: "Algorithm",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Algorithm</title>
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
  },
];

function activeForPath(pathname: string, href: string, key: NavKey): boolean {
  if (href === "/") return pathname === "/";
  if (key === "explore") {
    return pathname === "/trending" || pathname.startsWith("/trending");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

const SHELL_SIDEBAR_WIDTH_PX = 228;

type ShellSidebarProps = {
  open: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
};

export function ShellSidebar({ open, onClose, isLoggedIn }: ShellSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      aria-hidden={!open}
      style={{ width: open ? SHELL_SIDEBAR_WIDTH_PX : 0 }}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden bg-[hsl(var(--sidebar))] transition-[width,border-color] duration-200 ease-out",
        open
          ? "border-r border-[hsl(var(--border))]"
          : "border-r-0",
      )}
    >
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ width: SHELL_SIDEBAR_WIDTH_PX }}
      >
        <div className="flex shrink-0 items-center gap-1 bg-[hsl(var(--sidebar))] px-5 pb-4 pt-5">
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
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
          <BrandLogo />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2.5 pb-4 pt-3">
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active = activeForPath(pathname, n.href, n.key);
            return (
              <Link
                key={n.key}
                href={n.href}
                className={cn(
                  "ot-shell-nav-link",
                  active && "ot-shell-nav-link--active",
                )}
              >
                <span className="inline-flex h-5 w-5 shrink-0 [&_svg]:h-full [&_svg]:w-full">
                  {n.icon}
                </span>
                <span className="ot-shell-nav-label">{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mx-2.5 my-3.5 h-px bg-[hsl(var(--border))]" />

        <div className="flex flex-col gap-0.5">
          <Link
            href="/playlists"
            className={cn(
              "ot-shell-nav-link",
              pathname.startsWith("/playlists") && "ot-shell-nav-link--active",
            )}
          >
            <span className="inline-flex h-5 w-5 shrink-0 text-current">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden
              >
                <title>Playlists</title>
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </span>
            <span className="ot-shell-nav-label">Playlists</span>
          </Link>
          <Link
            href="/settings"
            className={cn(
              "ot-shell-nav-link",
              pathname.startsWith("/settings") && "ot-shell-nav-link--active",
            )}
          >
            <span className="inline-flex h-5 w-5 shrink-0">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden
              >
                <title>Settings</title>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </span>
            <span className="ot-shell-nav-label">Settings</span>
          </Link>
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
