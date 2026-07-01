"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { activeForPath, BOTTOM_NAV } from "@/components/shell/nav-config";
import { cn } from "@/lib/utils";

type ShellBottomNavProps = {
  /** Server-rendered account button + sheet (knows the session). */
  account: ReactNode;
};

export function ShellBottomNav({ account }: ShellBottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="ot-shell-bottom-nav grid shrink-0 grid-cols-5 border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] pb-[env(safe-area-inset-bottom)] min-[901px]:hidden"
    >
      {BOTTOM_NAV.map((n) => {
        const active = activeForPath(pathname, n.href, n.key);
        return (
          <Link
            key={n.key}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "ot-shell-bottom-nav-link flex h-14 flex-col items-center justify-center gap-1",
              active
                ? "text-[hsl(var(--primary))]"
                : "text-[hsl(var(--muted-foreground))]",
            )}
          >
            <span className="inline-flex h-6 w-6 shrink-0 [&_svg]:h-full [&_svg]:w-full">
              {active ? (n.iconActive ?? n.icon) : n.icon}
            </span>
            <span className="text-[10px] font-medium leading-none">
              {n.label}
            </span>
          </Link>
        );
      })}
      <div className="flex h-14 items-stretch justify-center">{account}</div>
    </nav>
  );
}
