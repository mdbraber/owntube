"use client";

import Link from "next/link";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { trpc } from "@/trpc/react";

type Props = {
  enabled: boolean;
};

export function SidebarSubscriptions({ enabled }: Props) {
  const { data, isLoading } = trpc.subscriptions.listSidebar.useQuery(
    { limit: 24 },
    {
      enabled,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

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
