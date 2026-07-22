"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SubscriptionChannelsList } from "@/components/subscriptions/subscription-channels-list";
import {
  SubscriptionTagFilter,
  type TagState,
} from "@/components/subscriptions/subscription-tag-filter";
import { SubscriptionVideosInfinite } from "@/components/subscriptions/subscription-videos-infinite";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

const TAG_FILTER_STORAGE_KEY = "ot:sub-tag-filter";

function readStoredTagStates(): Record<string, TagState> {
  try {
    const raw = localStorage.getItem(TAG_FILTER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TagState>;
    const out: Record<string, TagState> = {};
    for (const [tag, state] of Object.entries(parsed)) {
      if (state === "include" || state === "exclude") out[tag] = state;
    }
    return out;
  } catch {
    return {};
  }
}

type SubscriptionsTab = "videos" | "channels";

type SubscriptionsTabsProps = {
  channels: Parameters<typeof SubscriptionChannelsList>[0]["channels"];
};

/**
 * Subscriptions page content: Videos | Channels tabs (channel-page style)
 * with ONE tag filter that applies to both — the feed passes the selection to
 * the server query, the channel list filters rows by tag assignments. Both
 * panels stay mounted so switching tabs never refetches or loses scroll data.
 */
export function SubscriptionsTabs({ channels }: SubscriptionsTabsProps) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<SubscriptionsTab>("videos");

  // ── Shared tag filter (moved out of the videos feed) ──────────────────────
  const allTagsQuery = trpc.channelTags.listAll.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const [tagStates, setTagStates] = useState<Record<string, TagState>>({});
  const [tagHydrated, setTagHydrated] = useState(false);
  // A `?tag=` link (from a channel page) presets "only this tag"; otherwise
  // restore the persisted filter. Done in an effect to avoid SSR hydration drift.
  useEffect(() => {
    const paramTag = normalizeChannelTag(searchParams.get("tag") ?? "");
    setTagStates(paramTag ? { [paramTag]: "include" } : readStoredTagStates());
    setTagHydrated(true);
  }, [searchParams]);
  useEffect(() => {
    if (!tagHydrated) return;
    try {
      localStorage.setItem(TAG_FILTER_STORAGE_KEY, JSON.stringify(tagStates));
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }, [tagStates, tagHydrated]);
  // Drop persisted selections for tags that no longer exist (deleted/renamed,
  // or a stale ?tag= value) so a ghost tag can't filter everything to zero
  // with no visible pill to clear.
  useEffect(() => {
    if (!tagHydrated) return;
    const known = allTagsQuery.data;
    if (!known) return;
    const knownSet = new Set(known.map((t) => t.tag));
    setTagStates((prev) => {
      let changed = false;
      const next: Record<string, TagState> = {};
      for (const [tag, state] of Object.entries(prev)) {
        if (knownSet.has(tag)) next[tag] = state;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allTagsQuery.data, tagHydrated]);

  const includeTags = useMemo(
    () =>
      Object.entries(tagStates)
        .filter(([, s]) => s === "include")
        .map(([t]) => t),
    [tagStates],
  );
  const excludeTags = useMemo(
    () =>
      Object.entries(tagStates)
        .filter(([, s]) => s === "exclude")
        .map(([t]) => t),
    [tagStates],
  );

  const cycleTag = useCallback((tag: string) => {
    setTagStates((prev) => {
      const cur = prev[tag] ?? "off";
      const next: TagState =
        cur === "off" ? "include" : cur === "include" ? "exclude" : "off";
      const copy = { ...prev };
      if (next === "off") delete copy[tag];
      else copy[tag] = next;
      return copy;
    });
  }, []);
  const showAllTags = useCallback(() => setTagStates({}), []);
  const hideAllTags = useCallback(() => {
    const all = allTagsQuery.data ?? [];
    setTagStates(Object.fromEntries(all.map((t) => [t.tag, "exclude"])));
  }, [allTagsQuery.data]);

  const tabs: { id: SubscriptionsTab; label: string }[] = [
    { id: "videos", label: "Videos" },
    { id: "channels", label: "Channels" },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[hsl(var(--border))]">
        <div
          className="flex gap-1"
          role="tablist"
          aria-label="Subscriptions content"
        >
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? "border-b-2 border-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--foreground))]"
                    : "px-4 py-2.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
                }
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <SubscriptionTagFilter
        tags={allTagsQuery.data ?? []}
        stateFor={(tag) => tagStates[tag] ?? "off"}
        onCycle={cycleTag}
        onShowAll={showAllTags}
        onHideAll={hideAllTags}
      />

      <div className={cn(tab !== "videos" && "hidden")}>
        <SubscriptionVideosInfinite
          includeTags={includeTags}
          excludeTags={excludeTags}
        />
      </div>
      <div className={cn(tab !== "channels" && "hidden")}>
        <SubscriptionChannelsList
          channels={channels}
          includeTags={includeTags}
          excludeTags={excludeTags}
        />
      </div>
    </section>
  );
}
