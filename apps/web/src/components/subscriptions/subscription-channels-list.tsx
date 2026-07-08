"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChannelTags } from "@/components/channel/channel-tags";
import { SubscriptionUnfollowButton } from "@/components/subscriptions/subscription-unfollow-button";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { cn } from "@/lib/utils";
import { formatPublishedLabel } from "@/lib/video-display";

type Channel = {
  channelId: string;
  subscribedAt: number;
  channelName: string;
  avatarUrl: string | null;
  latestVideoAt: number | null;
};

type SortKey = "name" | "subscribed" | "lastVideo";

const SORT_LABEL: Record<SortKey, string> = {
  name: "Name",
  subscribed: "Subscribed",
  lastVideo: "Last video",
};

/** Natural direction when a key is first selected. */
const DEFAULT_DESC: Record<SortKey, boolean> = {
  name: false, // A → Z
  subscribed: true, // newest first
  lastVideo: true, // most recent upload first
};

const STORAGE_KEY = "ot-channels-sort";

function formatSubscribedDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * One-per-row list of followed channels with a persistent sort: name, date
 * subscribed, or last upload — clicking the active key flips its direction.
 */
export function SubscriptionChannelsList({
  channels,
}: {
  channels: Channel[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("subscribed");
  const [desc, setDesc] = useState(true);

  // Restore the persisted sort after hydration (server renders the default).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { key?: SortKey; desc?: boolean };
      if (parsed.key && parsed.key in SORT_LABEL) {
        setSortKey(parsed.key);
        setDesc(parsed.desc ?? DEFAULT_DESC[parsed.key]);
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  const selectSort = (key: SortKey) => {
    const nextDesc = key === sortKey ? !desc : DEFAULT_DESC[key];
    setSortKey(key);
    setDesc(nextDesc);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ key, desc: nextDesc }),
      );
    } catch {
      // storage unavailable
    }
  };

  const sorted = useMemo(() => {
    const copy = [...channels];
    copy.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "name":
          cmp = (a.channelName || a.channelId).localeCompare(
            b.channelName || b.channelId,
            undefined,
            { sensitivity: "base" },
          );
          break;
        case "subscribed":
          cmp = a.subscribedAt - b.subscribedAt;
          break;
        case "lastVideo":
          // Channels without a known upload sort last in either direction.
          cmp = (a.latestVideoAt ?? 0) - (b.latestVideoAt ?? 0);
          break;
      }
      return desc ? -cmp : cmp;
    });
    return copy;
  }, [channels, sortKey, desc]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
          Sort by
        </span>
        {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => {
          const active = key === sortKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectSort(key)}
              aria-pressed={active}
              title={
                active
                  ? "Reverse order"
                  : `Sort by ${SORT_LABEL[key].toLowerCase()}`
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition",
                active
                  ? "border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]",
              )}
            >
              {SORT_LABEL[key]}
              {active ? (
                <span aria-hidden className="text-[10px]">
                  {desc ? "↓" : "↑"}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <ul className="space-y-1">
        {sorted.map((c) => {
          const label = c.channelName || c.channelId;
          const lastVideoLabel = formatPublishedLabel(
            undefined,
            c.latestVideoAt ?? undefined,
          );
          return (
            <li key={c.channelId}>
              <div className="group flex items-center gap-3 rounded-[var(--radius-card)] p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]">
                <Link
                  href={`/channel/${encodeURIComponent(c.channelId)}`}
                  className="shrink-0"
                >
                  <ChannelAvatarCircle
                    imageUrl={c.avatarUrl ?? undefined}
                    label={label}
                    size="lg"
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/channel/${encodeURIComponent(c.channelId)}`}
                    className="block w-fit max-w-full truncate text-sm font-semibold text-[hsl(var(--foreground))] transition group-hover:text-[hsl(var(--primary))]"
                  >
                    {label}
                  </Link>
                  <div className="mt-1">
                    <ChannelTags channelId={c.channelId} isAuthed tone="card" />
                  </div>
                </div>
                <div className="hidden shrink-0 text-right text-xs text-[hsl(var(--muted-foreground))] sm:block">
                  <p>Subscribed {formatSubscribedDate(c.subscribedAt)}</p>
                  {lastVideoLabel ? (
                    <p className="mt-0.5">Last video {lastVideoLabel}</p>
                  ) : null}
                </div>
                <SubscriptionUnfollowButton channelId={c.channelId} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
