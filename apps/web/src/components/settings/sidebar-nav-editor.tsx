"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Toggle } from "@/components/settings/settings-ui";
import { useSettingsPatch } from "@/components/settings/use-settings-patch";
import { navItemByKey } from "@/components/shell/nav-config";
import { Button } from "@/components/ui/button";
import { useRowDrag } from "@/components/videos/use-row-drag";
import { DragHandleIcon, XIcon } from "@/components/videos/video-action-icons";
import {
  DEFAULT_SIDEBAR_NAV,
  isDividerKey,
  MAX_SIDEBAR_DIVIDERS,
  newDividerKey,
  resolveSidebarEntries,
  SIDEBAR_FOLLOWING,
  type SidebarNavEntry,
} from "@/lib/sidebar-nav";
import { cn } from "@/lib/utils";

const FollowingIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <title>Following</title>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </svg>
);

const DividerIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden
  >
    <title>Separator</title>
    <path d="M3 12h18" strokeDasharray="2 3" />
  </svg>
);

function entryLabel(key: string): { label: string; icon: ReactNode } | null {
  if (key === SIDEBAR_FOLLOWING) {
    return { label: "Following (your channels)", icon: FollowingIcon };
  }
  if (isDividerKey(key)) return { label: "Separator", icon: DividerIcon };
  const item = navItemByKey(key);
  return item ? { label: item.label, icon: item.icon } : null;
}

/**
 * Arranges the desktop sidebar: drag to reorder, switch entries on or off,
 * add and remove separators. Changes apply to the sidebar at once.
 */
export function SidebarNavEditor() {
  const { settings, save } = useSettingsPatch();
  const stored = settings?.sidebarNav ?? DEFAULT_SIDEBAR_NAV;
  const [entries, setEntries] = useState<SidebarNavEntry[]>(() =>
    resolveSidebarEntries(stored.items),
  );
  const storedKey = JSON.stringify(stored.items);
  // Follow the stored order (another tab, a reset) unless a drag is under way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialized items.
  useEffect(() => {
    setEntries(resolveSidebarEntries(stored.items));
  }, [storedKey]);

  const persist = (items: SidebarNavEntry[]) =>
    void save({ sidebarNav: { ...stored, items } });

  const drag = useRowDrag({
    count: entries.length,
    onMove: (from, to) =>
      setEntries((arr) => {
        const next = [...arr];
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        return next;
      }),
    onDrop: () =>
      setEntries((cur) => {
        persist(cur);
        return cur;
      }),
  });

  const dividerCount = entries.filter((e) => isDividerKey(e.key)).length;
  const isDefault =
    JSON.stringify(entries) === JSON.stringify(DEFAULT_SIDEBAR_NAV.items);

  return (
    <div className="space-y-2">
      <ul className="select-none space-y-1" {...drag.listProps}>
        {entries.map((entry, i) => {
          const meta = entryLabel(entry.key);
          if (!meta) return null;
          const isDragging = drag.dragging === i;
          return (
            <li
              key={entry.key}
              ref={drag.setRowRef(i)}
              style={
                isDragging
                  ? { transform: `translateY(${drag.dragY}px)` }
                  : undefined
              }
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1.5 pl-2 pr-3",
                isDragging && "relative z-10 shadow-lg",
              )}
            >
              <button
                type="button"
                className="cursor-grab touch-none p-1 text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] active:cursor-grabbing"
                onPointerDown={(e) => drag.handlePointerDown(e, i)}
                aria-label={`Drag ${meta.label}`}
              >
                <DragHandleIcon className="h-[18px] w-[18px]" />
              </button>
              <span
                className={cn(
                  "inline-flex h-5 w-5 shrink-0 [&_svg]:h-full [&_svg]:w-full",
                  entry.hidden
                    ? "text-[hsl(var(--muted-foreground))]/50"
                    : "text-[hsl(var(--muted-foreground))]",
                )}
              >
                {meta.icon}
              </span>
              <span
                className={cn(
                  "flex-1 text-sm font-medium",
                  entry.hidden &&
                    "text-[hsl(var(--muted-foreground))] line-through decoration-[hsl(var(--muted-foreground))]/40",
                )}
              >
                {meta.label}
              </span>
              {isDividerKey(entry.key) ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = entries.filter((e) => e.key !== entry.key);
                    setEntries(next);
                    persist(next);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                  title="Remove separator"
                  aria-label="Remove separator"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              ) : (
                <Toggle
                  checked={!entry.hidden}
                  label={`Show ${meta.label} in the sidebar`}
                  onChange={(on) => {
                    const next = entries.map((e) =>
                      e.key === entry.key ? { ...e, hidden: !on } : e,
                    );
                    setEntries(next);
                    persist(next);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={dividerCount >= MAX_SIDEBAR_DIVIDERS}
          onClick={() => {
            // At the top, where it's easy to see and drag into place.
            const next = [
              { key: newDividerKey(entries), hidden: false },
              ...entries,
            ];
            setEntries(next);
            persist(next);
          }}
        >
          Add separator
        </Button>
        {isDefault ? null : (
          <button
            type="button"
            className="text-xs text-[hsl(var(--muted-foreground))] underline-offset-2 hover:text-[hsl(var(--foreground))] hover:underline"
            onClick={() => {
              setEntries(DEFAULT_SIDEBAR_NAV.items);
              persist(DEFAULT_SIDEBAR_NAV.items);
            }}
          >
            Reset to the default
          </button>
        )}
      </div>
    </div>
  );
}
