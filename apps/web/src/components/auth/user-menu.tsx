"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ACCOUNT_LINKS } from "@/components/shell/nav-config";
import { cn } from "@/lib/utils";

type UserMenuProps = {
  initial: string;
  name?: string | null;
  email?: string | null;
  signOutAction: () => Promise<void>;
};

export function UserMenu({
  initial,
  name,
  email,
  signOutAction,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ot-brand-gradient text-sm font-bold text-white ot-brand-shadow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]"
        title={email ?? "Account"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initial}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 origin-top-right overflow-hidden rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl shadow-black/10 [animation:ot-fade-slide_0.12s_ease-out]"
        >
          <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full ot-brand-gradient text-sm font-bold text-white">
              {initial}
            </span>
            <div className="min-w-0">
              {name ? (
                <div className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                  {name}
                </div>
              ) : null}
              {email ? (
                <div className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                  {email}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col py-1.5">
            {ACCOUNT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-2 text-sm font-medium text-[hsl(var(--foreground))]",
                  "hover:bg-[hsl(var(--accent))]",
                )}
              >
                <span className="inline-flex h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))] [&_svg]:h-full [&_svg]:w-full">
                  {link.icon}
                </span>
                {link.label}
              </Link>
            ))}
          </div>

          <div className="border-t border-[hsl(var(--border))] py-1.5">
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-3 px-3.5 py-2 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
              >
                <span className="inline-flex h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))]">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <title>Sign out</title>
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="m16 17 5-5-5-5" />
                    <path d="M21 12H9" />
                  </svg>
                </span>
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
