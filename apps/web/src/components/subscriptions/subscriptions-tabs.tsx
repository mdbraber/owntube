"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionOptionsMenu } from "@/components/library/section-options-menu";
import { SubscriptionChannelsList } from "@/components/subscriptions/subscription-channels-list";
import {
  SubscriptionTagFilter,
  type TagState,
} from "@/components/subscriptions/subscription-tag-filter";
import { SubscriptionTagShelves } from "@/components/subscriptions/subscription-tag-shelves";
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

type SubscriptionsTab = "videos" | "byTag" | "channels";

/**
 * Subscriptions page content: Everything | By tag | Channels tabs
 * (channel-page style). ONE tag filter applies to Everything and Channels —
 * the feed passes the selection to the server query, the channel list filters
 * rows by tag assignments; By tag shows every tag as its own row instead.
 * Panels stay mounted once shown, so switching tabs never refetches or loses
 * scroll data.
 */
export function SubscriptionsTabs() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<SubscriptionsTab>("videos");
  // By tag mounts on first visit (it fetches a feed per tag), then stays.
  const [byTagShown, setByTagShown] = useState(false);
  useEffect(() => {
    if (tab === "byTag") setByTagShown(true);
  }, [tab]);

  // The Channels tab's list (every subscription with its meta) loads after
  // Everything has drawn: in the background once the page is idle, or at
  // once if Channels is opened first.
  const [channelsWanted, setChannelsWanted] = useState(false);
  useEffect(() => {
    if (tab === "channels") setChannelsWanted(true);
  }, [tab]);
  useEffect(() => {
    const timer = setTimeout(() => setChannelsWanted(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  const channelsQuery = trpc.subscriptions.listDetailed.useQuery(undefined, {
    enabled: channelsWanted,
    staleTime: 5 * 60_000,
  });

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
    { id: "videos", label: "Everything" },
    { id: "byTag", label: "By tag" },
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
        {/* Size and filters on every tab; By tag keeps its own shelf layout. */}
        <div className="pb-1.5">
          <SectionOptionsMenu
            section="subscriptions"
            showLayout={tab !== "byTag"}
          />
        </div>
      </div>

      {tab !== "byTag" ? (
        <SubscriptionTagFilter
          tags={allTagsQuery.data ?? []}
          stateFor={(tag) => tagStates[tag] ?? "off"}
          onCycle={cycleTag}
          onShowAll={showAllTags}
          onHideAll={hideAllTags}
        />
      ) : null}

      <div className={cn(tab !== "videos" && "hidden")}>
        <SubscriptionVideosInfinite
          includeTags={includeTags}
          excludeTags={excludeTags}
        />
      </div>
      {byTagShown ? (
        <div className={cn(tab !== "byTag" && "hidden")}>
          <SubscriptionTagShelves
            tags={allTagsQuery.data ?? []}
            onOpenTag={(tag) => {
              setTagStates({ [tag]: "include" });
              setTab("videos");
              window.scrollTo({ top: 0 });
            }}
          />
        </div>
      ) : null}
      <div className={cn(tab !== "channels" && "hidden")}>
        {channelsQuery.data ? (
          <SubscriptionChannelsList
            channels={channelsQuery.data}
            includeTags={includeTags}
            excludeTags={excludeTags}
          />
        ) : (
          <p className="py-6 text-sm text-[hsl(var(--muted-foreground))]">
            Loading channels…
          </p>
        )}
      </div>
    </section>
  );
}
