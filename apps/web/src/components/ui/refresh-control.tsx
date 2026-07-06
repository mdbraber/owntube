"use client";

import { cn } from "@/lib/utils";

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-3.5 w-3.5", spinning && "animate-spin")}
      aria-hidden
    >
      <title>Refresh</title>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** "Updated 4m ago" — coarse relative time from a unix-seconds timestamp. */
export function formatUpdatedAgo(unixSeconds?: number | null): string | null {
  if (!unixSeconds) return null;
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

type RefreshControlProps = {
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Unix seconds of the last successful refresh; shows an "Updated …" hint. */
  refreshedAt?: number | null;
  label?: string;
  className?: string;
};

/**
 * Consistent cache-first refresh affordance: a pill button that spins while
 * refreshing, with an optional "Updated … ago" staleness hint. Pairs with a
 * server refresh mutation that bypasses caches and returns `refreshedAt`.
 */
export function RefreshControl({
  onRefresh,
  isRefreshing,
  refreshedAt,
  label = "Refresh",
  className,
}: RefreshControlProps) {
  const ago = formatUpdatedAgo(refreshedAt);
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {ago ? (
        <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
          Updated {ago}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label={label}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] shadow-sm transition",
          "hover:border-[hsl(var(--primary)_/_0.5)] hover:bg-[hsl(var(--primary)_/_0.06)] hover:text-[hsl(var(--primary))]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
          "disabled:cursor-default disabled:opacity-60",
        )}
      >
        <RefreshIcon spinning={isRefreshing} />
        <span>{isRefreshing ? "Refreshing…" : label}</span>
      </button>
    </div>
  );
}
