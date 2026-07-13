"use client";

import Link from "next/link";
import { useState } from "react";
import { MOBILE_SHEET_LINKS } from "@/components/shell/nav-config";
import { Sheet } from "@/components/ui/sheet";

type MobileAccountSheetProps = {
  isLoggedIn: boolean;
  initial: string;
  name?: string | null;
  email?: string | null;
  signOutAction: () => Promise<void>;
};

// Subscriptions already has its own tab in the bottom bar, so drop it here.
const SHEET_LINKS = MOBILE_SHEET_LINKS;

export function MobileAccountSheet({
  isLoggedIn,
  initial,
  name,
  email,
  signOutAction,
}: MobileAccountSheetProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full w-full flex-col items-center justify-center gap-1 text-[hsl(var(--muted-foreground))]"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {isLoggedIn ? (
          <span className="flex h-6 w-6 items-center justify-center rounded-full ot-brand-gradient text-[11px] font-bold text-white">
            {initial}
          </span>
        ) : (
          <span className="inline-flex h-6 w-6 items-center justify-center [&_svg]:h-6 [&_svg]:w-6">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <title>Account</title>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          </span>
        )}
        <span className="text-[10px] font-medium leading-none">Account</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen} title="Account menu">
        {isLoggedIn ? (
          <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full ot-brand-gradient text-base font-bold text-white">
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
        ) : null}

        <div className="flex flex-col py-1.5">
          {SHEET_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
            >
              <span className="inline-flex h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))] [&_svg]:h-full [&_svg]:w-full">
                {link.icon}
              </span>
              {link.label}
            </Link>
          ))}
        </div>

        <div className="border-t border-[hsl(var(--border))] py-1.5">
          {isLoggedIn ? (
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
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
          ) : (
            <div className="flex flex-col">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="px-4 py-3 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="px-4 py-3 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--accent))]"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
