"use client";

import type { ReactNode } from "react";

type WatchPageGridProps = {
  primary: ReactNode;
};

/**
 * Watch layout: a single column — the below-video content (description,
 * comments, related) lives in WatchContentTabs, so there is no sidebar and
 * cinema mode needs no special grid handling anymore.
 */
export function WatchPageGrid({ primary }: WatchPageGridProps) {
  return (
    <main className="ot-page grid min-h-0 grid-cols-1 gap-6">
      <section className="min-w-0 space-y-5">{primary}</section>
    </main>
  );
}
