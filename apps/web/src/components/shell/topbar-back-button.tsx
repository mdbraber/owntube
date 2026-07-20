"use client";

import { usePathname, useRouter } from "next/navigation";

/**
 * In-app back button for mobile — a PWA installed to the home screen has no
 * browser chrome/back gesture, so this is the only way back. Shown on every
 * page except home; falls back to Home when there's no in-app history (e.g. a
 * deep link opened cold) so it never strands the user or leaves the app.
 */
export function TopbarBackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/") return null;

  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push("/");
        }
      }}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-shell)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] min-[901px]:hidden"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <title>Back</title>
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}
