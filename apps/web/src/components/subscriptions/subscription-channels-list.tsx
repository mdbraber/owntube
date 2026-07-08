"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChannelTags } from "@/components/channel/channel-tags";
import { SubscriptionUnfollowButton } from "@/components/subscriptions/subscription-unfollow-button";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { cn } from "@/lib/utils";
import { formatPublishedLabel } from "@/lib/video-display";
import { trpc } from "@/trpc/react";

type Channel = {
  channelId: string;
  subscribedAt: number;
  channelName: string;
  avatarUrl: string | null;
  description: string | null;
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
  const [groupByTag, setGroupByTag] = useState(false);

  // Restore the persisted view after hydration (server renders the default).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        key?: SortKey;
        desc?: boolean;
        group?: boolean;
      };
      if (parsed.key && parsed.key in SORT_LABEL) {
        setSortKey(parsed.key);
        setDesc(parsed.desc ?? DEFAULT_DESC[parsed.key]);
      }
      setGroupByTag(parsed.group ?? false);
    } catch {
      // ignore malformed storage
    }
  }, []);

  const persist = (key: SortKey, nextDesc: boolean, group: boolean) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ key, desc: nextDesc, group }),
      );
    } catch {
      // storage unavailable
    }
  };

  const selectSort = (key: SortKey) => {
    const nextDesc = key === sortKey ? !desc : DEFAULT_DESC[key];
    setSortKey(key);
    setDesc(nextDesc);
    persist(key, nextDesc, groupByTag);
  };

  const toggleGroup = () => {
    setGroupByTag((g) => {
      persist(sortKey, desc, !g);
      return !g;
    });
  };

  // Live (channelId, tag) pairs — tag edits made inline in any row invalidate
  // this query, so every group updates immediately.
  const assignments = trpc.channelTags.assignments.useQuery(undefined, {
    enabled: groupByTag,
  });

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

  /** Tag → sorted channels (a channel appears under each of its tags). */
  const groups = useMemo(() => {
    if (!groupByTag) return null;
    const tagsByChannel = new Map<string, string[]>();
    for (const row of assignments.data ?? []) {
      const list = tagsByChannel.get(row.channelId) ?? [];
      list.push(row.tag);
      tagsByChannel.set(row.channelId, list);
    }
    const byTag = new Map<string, Channel[]>();
    const untagged: Channel[] = [];
    for (const c of sorted) {
      const tags = tagsByChannel.get(c.channelId);
      if (!tags || tags.length === 0) {
        untagged.push(c);
        continue;
      }
      for (const tag of tags) {
        const list = byTag.get(tag) ?? [];
        list.push(c);
        byTag.set(tag, list);
      }
    }
    const named = [...byTag.entries()].sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    return { named, untagged };
  }, [groupByTag, assignments.data, sorted]);

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
        <span aria-hidden className="mx-1 h-4 w-px bg-[hsl(var(--border))]" />
        <button
          type="button"
          onClick={toggleGroup}
          aria-pressed={groupByTag}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition",
            groupByTag
              ? "border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]",
          )}
        >
          Group by tag
        </button>
      </div>

      {groups ? (
        <div className="space-y-7">
          {groups.named.map(([tag, list]) => (
            <section key={tag}>
              <GroupHeader tag={tag} count={list.length} />
              <ul className="space-y-1">
                {list.map((c) => (
                  <ChannelRow key={c.channelId} channel={c} />
                ))}
              </ul>
            </section>
          ))}
          {groups.untagged.length > 0 ? (
            <section>
              <GroupHeader count={groups.untagged.length} />
              <ul className="space-y-1">
                {groups.untagged.map((c) => (
                  <ChannelRow key={c.channelId} channel={c} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-1">
          {sorted.map((c) => (
            <ChannelRow key={c.channelId} channel={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Group heading in the app's tag-pill language: the tag as a brand-tinted
 * pill (linking to the subscriptions feed filtered to it), a channel count,
 * and a hairline rule carrying the eye across the row. Untagged gets the
 * neutral variant.
 */
function GroupHeader({ tag, count }: { tag?: string; count: number }) {
  const pillClass = cn(
    "inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold",
    tag
      ? "border-[hsl(var(--primary)_/_0.4)] bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--primary)_/_0.18)]"
      : "border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.5)] text-[hsl(var(--muted-foreground))]",
  );
  return (
    <div className="mb-2 flex items-center gap-3 px-1">
      {tag ? (
        <Link
          href={`/subscriptions?tag=${encodeURIComponent(tag)}`}
          className={pillClass}
          title={`Show subscriptions tagged "${tag}"`}
        >
          #{tag}
        </Link>
      ) : (
        <span className={pillClass}>Untagged</span>
      )}
      <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
        {count} {count === 1 ? "channel" : "channels"}
      </span>
      <span aria-hidden className="h-px flex-1 bg-[hsl(var(--border))]" />
    </div>
  );
}

function ChannelRow({ channel: c }: { channel: Channel }) {
  const label = c.channelName || c.channelId;
  const lastVideoLabel = formatPublishedLabel(
    undefined,
    c.latestVideoAt ?? undefined,
  );
  return (
    <li>
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
          {c.description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-[hsl(var(--muted-foreground))]">
              {c.description}
            </p>
          ) : null}
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
}
