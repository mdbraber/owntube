"use client";

import { useEffect, useRef, useState } from "react";
import { MoreIcon } from "@/components/videos/video-action-icons";
import {
  HOME_BLOCK_SIZE_LABEL,
  HOME_BLOCK_SIZES,
  type HomeBlockSize,
} from "@/lib/home-blocks";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

export type LibrarySection = "history" | "queue" | "saved";

const DEFAULT_PREFS = { hideCompleted: false, rowSize: "md" as HomeBlockSize };

/** The page's persisted prefs from the sectionPrefs base (live query). */
export function useSectionPagePrefs(section: LibrarySection): {
  hideCompleted: boolean;
  rowSize: HomeBlockSize;
} {
  const settings = trpc.settings.get.useQuery();
  return settings.data?.sectionPrefs[section] ?? DEFAULT_PREFS;
}

/**
 * Library-page options behind a ⋯ menu (History / Queue / Saved): row size
 * (XS–XL) and the hide-watched filter. Values live in the shared
 * sectionPrefs base, one entry per page.
 */
export function SectionOptionsMenu({ section }: { section: LibrarySection }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSettled: () => utils.settings.get.invalidate(),
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const prefs = settings.data?.sectionPrefs ?? {
    history: DEFAULT_PREFS,
    queue: DEFAULT_PREFS,
    saved: DEFAULT_PREFS,
  };
  const current = prefs[section] ?? DEFAULT_PREFS;

  const patch = (next: Partial<typeof current>) =>
    update.mutate({
      sectionPrefs: { ...prefs, [section]: { ...current, ...next } },
    });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        title="Page options"
        aria-label="Page options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon className="h-5 w-5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm shadow-lg"
        >
          <p className="px-1 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Row size
          </p>
          <div className="flex overflow-hidden rounded-full border border-[hsl(var(--border))] text-xs font-medium">
            {HOME_BLOCK_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={current.rowSize === size}
                className={cn(
                  "flex-1 px-2 py-1.5 transition",
                  current.rowSize === size
                    ? "bg-[hsl(var(--primary))] text-white"
                    : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                )}
                onClick={() => patch({ rowSize: size })}
              >
                {HOME_BLOCK_SIZE_LABEL[size]}
              </button>
            ))}
          </div>
          <label className="mt-2 flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-1 py-2 transition hover:bg-[hsl(var(--muted)_/_0.65)]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(var(--primary))]"
              checked={current.hideCompleted}
              onChange={(e) =>
                patch({ hideCompleted: e.currentTarget.checked })
              }
            />
            Hide watched videos
          </label>
        </div>
      ) : null}
    </div>
  );
}
