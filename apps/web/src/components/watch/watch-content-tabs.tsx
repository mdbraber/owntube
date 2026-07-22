"use client";

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

type WatchTabId = "description" | "comments" | "related";

type WatchContentTabsProps = {
  description: ReactNode;
  comments: ReactNode;
  related: ReactNode;
  /** "Related" normally; "From your feed" when the sidebar fell back. */
  relatedLabel: string;
};

/**
 * Watch-page content tabs (Description | Comments | Related), styled like the
 * channel page's section tabs. All panels stay mounted — the inactive ones are
 * just hidden — so the server-rendered related list survives tab switches and
 * comments keep their loaded state.
 */
export function WatchContentTabs({
  description,
  comments,
  related,
  relatedLabel,
}: WatchContentTabsProps) {
  const [tab, setTab] = useState<WatchTabId>("description");

  const tabs: { id: WatchTabId; label: string }[] = [
    { id: "description", label: "Description" },
    { id: "comments", label: "Comments" },
    { id: "related", label: relatedLabel },
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
      <div className={cn(tab !== "related" && "hidden")}>{related}</div>
    </section>
  );
}
