"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { trpc } from "@/trpc/react";

type Props = {
  enabled: boolean;
};

export function SidebarSubscriptions({ enabled }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.subscriptions.listSidebar.useQuery(
    { limit: 24 },
    {
      enabled,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  // Backfill newest-upload times (for ordering) and any missing names/avatars
  // once per session; re-sort the list when it finishes. Idempotent server-side.
  const refresh = trpc.subscriptions.refreshRecency.useMutation({
    onSuccess: (res) => {
      if (res.updated > 0) utils.subscriptions.listSidebar.invalidate();
    },
  });
  const startedRef = useRef(false);
  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    refresh.mutate();
  }, [enabled, refresh]);

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
        Loading…
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <p className="px-3 py-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        Subscribe on channel pages — channels appear here.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <div className="max-h-[min(52vh,22rem)] min-h-0 overflow-y-auto overscroll-contain pr-0.5">
        {rows.map((s) => {
          const label = s.channelName || s.channelId;
          return (
            <Link
              key={s.channelId}
              href={`/channel/${encodeURIComponent(s.channelId)}`}
              className="group relative flex w-full items-center gap-3.5 rounded-[var(--radius-shell)] px-3 py-2.5 text-left text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--accent))]"
            >
              <ChannelAvatarCircle
                imageUrl={s.avatarUrl ?? undefined}
                label={label}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))] opacity-0 shadow-[0_0_6px_hsl(var(--primary)_/_0.6)] group-hover:opacity-100"
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
      <Link
        href="/subscriptions/channels"
        className="mx-3 mb-1 rounded-lg px-3 py-2 text-xs font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
      >
        View all channels
      </Link>
    </div>
  );
}

/**
 * The Following section of the sidebar: a header that expands and collapses
 * the subscribed-channels list (the choice is saved with the sidebar setting).
 */
export function SidebarFollowing({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const listId = useId();
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={listId}
        className="flex w-full items-center justify-between rounded-[var(--radius-shell)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        Following
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`h-4 w-4 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
        >
          <title>{collapsed ? "Expand" : "Collapse"}</title>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        id={listId}
        className={collapsed ? "hidden" : "mt-1 flex flex-col gap-0.5"}
      >
        {collapsed ? null : <SidebarSubscriptions enabled />}
      </div>
    </div>
  );
}
