"use client";

import type { ReactNode } from "react";
import { useWatchCinema } from "@/components/watch/watch-cinema-context";

type WatchPageGridProps = {
  primary: ReactNode;
  sidebar: ReactNode;
};

/**
 * Watch layout: video column plus a chapters/related sidebar on lg+. In
 * cinema mode the grid collapses to a single full-width column and the
 * sidebar is NOT rendered at all — its content (chapters, related) appears
 * as extra tabs in WatchContentTabs instead, so it is mounted exactly once.
 */
export function WatchPageGrid({ primary, sidebar }: WatchPageGridProps) {
  const cinema = useWatchCinema();
  const cinemaMode = Boolean(cinema?.cinemaMode);

  return (
    <main
      className={
        cinemaMode
          ? "ot-page grid min-h-0 grid-cols-1 gap-6"
          : "ot-page grid min-h-0 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)]"
      }
    >
      <section className="min-w-0 space-y-5">{primary}</section>
      {cinemaMode ? null : (
        <aside className="min-w-0 space-y-4">{sidebar}</aside>
      )}
    </main>
  );
}
