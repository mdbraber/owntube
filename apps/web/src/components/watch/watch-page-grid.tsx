"use client";

import type { ReactNode } from "react";
import { useWatchCinema } from "@/components/watch/watch-cinema-context";
import { cn } from "@/lib/utils";

type WatchPageGridProps = {
  primary: ReactNode;
  sidebar: ReactNode;
};

/**
 * Watch layout: in cinema mode the main column is full width (single grid
 * track) so the player is not cropped or stacked over the feed; the feed
 * moves below the primary column.
 */
export function WatchPageGrid({ primary, sidebar }: WatchPageGridProps) {
  const cinema = useWatchCinema();
  const cinemaMode = Boolean(cinema?.cinemaMode);

  return (
    <main
      className={cn(
        "ot-page grid min-h-0 gap-8",
        cinemaMode
          ? "grid-cols-1 gap-y-6"
          : "lg:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)]",
      )}
    >
      <section className="min-w-0 space-y-5">{primary}</section>
      <aside
        className={cn(
          "min-w-0 space-y-4",
          cinemaMode &&
            "border-t border-[hsl(var(--border))] pt-6 lg:border-t-0 lg:pt-0",
        )}
      >
        {sidebar}
      </aside>
    </main>
  );
}
