"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASSIGNABLE_NAV,
  navItemByKey,
} from "@/components/shell/nav-config";
import { DragHandleIcon, XIcon } from "@/components/videos/video-action-icons";
import { useRowDrag } from "@/components/videos/use-row-drag";
import {
  DEFAULT_BOTTOM_NAV_KEYS,
  MAX_BOTTOM_NAV,
  MIN_BOTTOM_NAV,
  sanitizeBottomNav,
} from "@/lib/bottom-nav";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

/**
 * Configures the mobile bottom tab bar: drag to reorder the tabs, add/remove
 * from the pool. 1–5 tabs; everything left out is reachable under the Account
 * button. The Account button itself is always the last cell and isn't listed.
 */
export function BottomNavEditor() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSettled: () => utils.settings.get.invalidate(),
  });

  const [bar, setBar] = useState<string[]>([...DEFAULT_BOTTOM_NAV_KEYS]);
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    const stored = settings.data?.bottomNav;
    if (stored) {
      hydratedRef.current = true;
      setBar(sanitizeBottomNav(stored));
    }
  }, [settings.data?.bottomNav]);

  const save = useCallback(
    (next: string[]) => {
      setBar(next);
      update.mutate({ bottomNav: next });
    },
    [update],
  );

  const drag = useRowDrag({
    count: bar.length,
    onMove: (from, to) =>
      setBar((arr) => {
        const next = [...arr];
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        return next;
      }),
    onDrop: () =>
      setBar((cur) => {
        update.mutate({ bottomNav: cur });
        return cur;
      }),
  });

  const available = ASSIGNABLE_NAV.filter((n) => !bar.includes(n.key));
  const canRemove = bar.length > MIN_BOTTOM_NAV;
  const canAdd = bar.length < MAX_BOTTOM_NAV;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="m-0 text-sm font-semibold text-[hsl(var(--foreground))]">
          Bottom navigation
        </h3>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          Drag to reorder the mobile tab bar ({MIN_BOTTOM_NAV}–{MAX_BOTTOM_NAV}{" "}
          tabs). Everything else moves under the Account button.
        </p>
      </div>

      {/* In the tab bar */}
      <ul className="select-none space-y-1.5" {...drag.listProps}>
        {bar.map((key, i) => {
          const item = navItemByKey(key);
          if (!item) return null;
          const isDragging = drag.dragging === i;
          return (
            <li
              key={key}
              ref={drag.setRowRef(i)}
              style={
                isDragging
                  ? { transform: `translateY(${drag.dragY}px)` }
                  : undefined
              }
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2",
                isDragging && "relative z-10 shadow-lg",
              )}
            >
              <button
                type="button"
                className="cursor-grab touch-none text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] active:cursor-grabbing"
                onPointerDown={(e) => drag.handlePointerDown(e, i)}
                aria-label={`Drag ${item.label}`}
              >
                <DragHandleIcon className="h-[18px] w-[18px]" />
              </button>
              <span className="inline-flex h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))] [&_svg]:h-full [&_svg]:w-full">
                {item.icon}
              </span>
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              <button
                type="button"
                disabled={!canRemove}
                onClick={() => save(bar.filter((k) => k !== key))}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30"
                title={canRemove ? "Remove from tab bar" : "Keep at least one tab"}
                aria-label={`Remove ${item.label} from tab bar`}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {/* Available (under the Account button) */}
      {available.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Under Account
          </p>
          <ul className="space-y-1.5">
            {available.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] px-3 py-2"
              >
                <span className="inline-flex h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))] [&_svg]:h-full [&_svg]:w-full">
                  {item.icon}
                </span>
                <span className="flex-1 text-sm font-medium text-[hsl(var(--muted-foreground))]">
                  {item.label}
                </span>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => save([...bar, item.key])}
                  className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-semibold text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-30"
                  title={canAdd ? "Add to tab bar" : `Up to ${MAX_BOTTOM_NAV} tabs`}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
