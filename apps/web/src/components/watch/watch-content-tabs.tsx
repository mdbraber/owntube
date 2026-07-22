"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useWatchCinema } from "@/components/watch/watch-cinema-context";
import { cn } from "@/lib/utils";

type WatchTabId = "description" | "comments" | "chapters" | "related";

type WatchContentTabsProps = {
  description: ReactNode;
  comments: ReactNode;
  /** Rendered as extra tabs in cinema mode only (the sidebar is gone there). */
  chapters?: ReactNode;
  related?: ReactNode;
  /** "Related" normally; "From your feed" when the sidebar fell back. */
  relatedLabel: string;
};

/**
 * Watch-page content tabs, styled like the channel page's section tabs.
 * Normal mode: Description | Comments (chapters + related live in the
 * sidebar next to the video). Cinema mode: the sidebar is not rendered, so
 * Chapters and Related join as tabs. Description/comments panels stay
 * mounted across switches; the cinema-only panels mount only in cinema so
 * the same nodes are never in the DOM twice.
 */
export function WatchContentTabs({
  description,
  comments,
  chapters,
  related,
  relatedLabel,
}: WatchContentTabsProps) {
  const cinema = useWatchCinema();
  const cinemaMode = Boolean(cinema?.cinemaMode);
  const [tab, setTab] = useState<WatchTabId>("description");

  // Leaving cinema removes the Chapters/Related tabs — fall back to a tab
  // that still exists instead of an empty panel.
  useEffect(() => {
    if (!cinemaMode && (tab === "chapters" || tab === "related")) {
      setTab("description");
    }
  }, [cinemaMode, tab]);

  const tabs: { id: WatchTabId; label: string }[] = [
    { id: "description", label: "Description" },
    { id: "comments", label: "Comments" },
    ...(cinemaMode && chapters
      ? [{ id: "chapters" as const, label: "Chapters" }]
      : []),
    ...(cinemaMode && related
      ? [{ id: "related" as const, label: relatedLabel }]
      : []),
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[hsl(var(--border))]">
        <div className="flex gap-1" role="tablist" aria-label="Video content">
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
      <div className={cn(tab !== "description" && "hidden")}>{description}</div>
      <div className={cn(tab !== "comments" && "hidden")}>{comments}</div>
      {cinemaMode && chapters ? (
        <div className={cn(tab !== "chapters" && "hidden")}>{chapters}</div>
      ) : null}
      {cinemaMode && related ? (
        <div className={cn(tab !== "related" && "hidden")}>{related}</div>
      ) : null}
    </section>
  );
}
