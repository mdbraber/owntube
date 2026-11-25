"use client";

import { useEffect, useRef, useState } from "react";
import { CopyRssUrlButton } from "@/components/feeds/copy-rss-url";
import { SubscriptionTagShelf } from "@/components/home/home-blocks-client";
import { useFeedPagePrefs } from "@/components/library/section-options-menu";
import type { HomeBlockSize } from "@/lib/home-blocks";

type Tag = { tag: string; count: number };

/**
 * Subscriptions > By tag: a scrollable row per tag with the newest uploads
 * from the channels carrying it. Lazy both ways: a row mounts (and fetches its
 * first dozen) only as it nears the viewport, pages in more as it is swiped
 * sideways, and once scrolled far off it skips rendering (content-visibility)
 * so a long page stays light. Size and the filters come from the ⋯ menu.
 */
export function SubscriptionTagShelves({
  tags,
  onOpenTag,
}: {
  tags: Tag[];
  /** A tag's heading: its whole feed (Everything, filtered to the tag). */
  onOpenTag: (tag: string) => void;
}) {
  const prefs = useFeedPagePrefs("subscriptions");
  if (tags.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No tags yet. Tag channels from their channel page to group them here.
      </p>
    );
  }
  return (
    <div className="space-y-8">
      {tags.map((t) => (
        <TagSection
          key={t.tag}
          tag={t.tag}
          count={t.count}
          onOpen={() => onOpenTag(t.tag)}
          size={prefs.rowSize}
          hideWatched={prefs.hideCompleted}
          hideShorts={prefs.hideShorts}
          hideIgnored={prefs.hideIgnored}
        />
      ))}
    </div>
  );
}

function TagSection({
  tag,
  count,
  onOpen,
  size,
  hideWatched,
  hideShorts,
  hideIgnored,
}: Tag & {
  onOpen: () => void;
  size: HomeBlockSize;
  hideWatched: boolean;
  hideShorts: boolean;
  hideIgnored: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setNear(true);
      },
      { rootMargin: "600px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [near]);

  return (
    <section
      ref={ref}
      className="min-w-0 space-y-3"
      // Off-screen rows keep their DOM (scroll position, loaded pages) but skip
      // layout and paint; the intrinsic size stands in for their height.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 20rem" }}
    >
      <h2 className="flex items-baseline gap-2 text-lg font-semibold">
        <button type="button" onClick={onOpen} className="hover:underline">
          {tag}
        </button>
        <span className="text-sm font-normal text-[hsl(var(--muted-foreground))]">
          {count} {count === 1 ? "channel" : "channels"}
        </span>
        <span className="ml-auto self-center">
          <CopyRssUrlButton kind="tag" refId={tag} trigger="more" />
        </span>
      </h2>
      {near ? (
        <SubscriptionTagShelf
          tag={tag}
          size={size}
          hideWatched={hideWatched}
          hideShorts={hideShorts}
          hideIgnored={hideIgnored}
        />
      ) : (
        // Holds the row's height until it loads, so the page doesn't jump.
        <div className="h-56" aria-hidden />
      )}
    </section>
  );
}
