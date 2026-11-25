"use client";

import { useEffect, useRef, useState } from "react";
import { useCopyRssUrl } from "@/components/feeds/copy-rss-url";
import { MoreIcon } from "@/components/videos/video-action-icons";
import {
  HOME_BLOCK_ROWS,
  HOME_BLOCK_SIZE_LABEL,
  HOME_BLOCK_SIZES,
  type HomeBlockSize,
} from "@/lib/home-blocks";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

export type LibrarySection = "history" | "queue" | "saved";
/** Pages showing the merged subscription feed (home-block style options). */
export type FeedSection = "subscriptions" | "favorites" | "tags";
export type OptionsSection = LibrarySection | FeedSection;

export type FeedLayout = "cards" | "rows";

const DEFAULT_PREFS = { hideCompleted: false, rowSize: "md" as HomeBlockSize };
const DEFAULT_FEED_PREFS = {
  ...DEFAULT_PREFS,
  layout: "cards" as FeedLayout,
  rows: 0,
  hideShorts: undefined as boolean | undefined,
  hideIgnored: true,
};

/** Row caps offered on feed pages; 0 = all (infinite scroll). */
export const FEED_PAGE_ROWS = [0, ...HOME_BLOCK_ROWS] as const;

/** The page's persisted prefs from the sectionPrefs base (live query). */
export function useSectionPagePrefs(section: OptionsSection): {
  hideCompleted: boolean;
  rowSize: HomeBlockSize;
} {
  const settings = trpc.settings.get.useQuery();
  return settings.data?.sectionPrefs[section] ?? DEFAULT_PREFS;
}

export type FeedPagePrefs = {
  hideCompleted: boolean;
  rowSize: HomeBlockSize;
  layout: FeedLayout;
  /** Rows shown; 0 = all, with infinite scroll. */
  rows: number;
  /** Effective value: the page's own choice, else the profile setting. */
  hideShorts: boolean;
  /** True once the page has its own Shorts choice (else omit it from queries). */
  hideShortsSet: boolean;
  hideIgnored: boolean;
};

/** A feed page's prefs, with hideShorts resolved against the profile. */
export function useFeedPagePrefs(section: FeedSection): FeedPagePrefs {
  const settings = trpc.settings.get.useQuery();
  const prefs = settings.data?.sectionPrefs[section] ?? DEFAULT_FEED_PREFS;
  const profileHideShorts = settings.data?.hideShortsInSubscriptions ?? true;
  return {
    hideCompleted: prefs.hideCompleted,
    rowSize: prefs.rowSize,
    layout: prefs.layout,
    rows: prefs.rows,
    hideShorts: prefs.hideShorts ?? profileHideShorts,
    hideShortsSet: prefs.hideShorts !== undefined,
    hideIgnored: prefs.hideIgnored,
  };
}

function isFeedSection(section: OptionsSection): section is FeedSection {
  return (
    section === "subscriptions" || section === "favorites" || section === "tags"
  );
}

/**
 * Page options behind a ⋯ menu. Library pages (History / Queue / Saved): row
 * size and hide watched. Feed pages (Subscriptions / Favorites / tags): the
 * home block options — size, cards or rows, number of rows, hide watched /
 * Shorts / ignored. Values live in the shared sectionPrefs base, one entry
 * per page.
 */
export function SectionOptionsMenu({
  section,
  showLayout = true,
}: {
  section: OptionsSection;
  /** Feed pages: off where the tab has its own layout (Subscriptions > By tag). */
  showLayout?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  // Optimistic: the checkbox and the filtered lists change on the tap, not
  // after the save round-trip (seconds on a slow server).
  const update = trpc.settings.update.useMutation({
    onMutate: async (patch) => {
      await utils.settings.get.cancel();
      const previous = utils.settings.get.getData();
      utils.settings.get.setData(undefined, (old) =>
        old && patch.sectionPrefs
          ? {
              ...old,
              // This menu always sends every section, complete (see patch).
              sectionPrefs: patch.sectionPrefs as typeof old.sectionPrefs,
            }
          : old,
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous)
        utils.settings.get.setData(undefined, context.previous);
    },
    onSettled: () => utils.settings.get.invalidate(),
  });
  const copyRssUrl = useCopyRssUrl();

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

  const feed = isFeedSection(section);
  const feedPrefs = useFeedPagePrefs(feed ? section : "subscriptions");
  const prefs = settings.data?.sectionPrefs ?? {
    history: DEFAULT_PREFS,
    queue: DEFAULT_PREFS,
    saved: DEFAULT_PREFS,
    subscriptions: DEFAULT_FEED_PREFS,
    favorites: DEFAULT_FEED_PREFS,
    tags: DEFAULT_FEED_PREFS,
  };
  const current = prefs[section];

  const patch = (next: Partial<typeof DEFAULT_FEED_PREFS>) =>
    update.mutate({
      sectionPrefs: { ...prefs, [section]: { ...current, ...next } },
    });

  const pills = <T extends string | number>(
    label: string,
    values: readonly T[],
    selected: T,
    text: (value: T) => string,
    onPick: (value: T) => void,
  ) => (
    <div className="pb-2">
      <p className="px-1 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      <div className="flex overflow-hidden rounded-full border border-[hsl(var(--border))] text-xs font-medium">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={selected === value}
            className={cn(
              "flex-1 px-2 py-1.5 transition",
              selected === value
                ? "bg-[hsl(var(--primary))] text-white"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
            )}
            onClick={() => onPick(value)}
          >
            {text(value)}
          </button>
        ))}
      </div>
    </div>
  );

  const checkbox = (
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ) => (
    <label className="flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-1 py-2 transition hover:bg-[hsl(var(--muted)_/_0.65)]">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[hsl(var(--primary))]"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );

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
          {pills(
            feed ? "Size" : "Row size",
            HOME_BLOCK_SIZES,
            current.rowSize,
            (size) => HOME_BLOCK_SIZE_LABEL[size],
            (rowSize) => patch({ rowSize }),
          )}
          {feed && showLayout ? (
            <>
              {pills(
                "Layout",
                ["cards", "rows"] as const,
                feedPrefs.layout,
                (layout) => (layout === "cards" ? "Cards" : "Rows"),
                (layout) => patch({ layout }),
              )}
              {pills(
                "Rows",
                FEED_PAGE_ROWS,
                feedPrefs.rows,
                (n) => (n === 0 ? "All" : String(n)),
                (rows) => patch({ rows }),
              )}
            </>
          ) : null}
          {checkbox("Hide watched videos", current.hideCompleted, (v) =>
            patch({ hideCompleted: v }),
          )}
          {feed ? (
            <>
              {checkbox("Hide Shorts", feedPrefs.hideShorts, (v) =>
                patch({ hideShorts: v }),
              )}
              {checkbox("Hide ignored videos", feedPrefs.hideIgnored, (v) =>
                patch({ hideIgnored: v }),
              )}
            </>
          ) : null}
          {/* History has no companion feed; Queue and Saved publish as fixed
              slugs (Subscriptions has its own Copy RSS URL button). */}
          {section === "queue" || section === "saved"
            ? (["audio", "video"] as const).map((variant) => (
                <button
                  key={variant}
                  type="button"
                  role="menuitem"
                  className="mt-1 w-full rounded-lg px-1 py-2 text-left transition hover:bg-[hsl(var(--muted)_/_0.65)]"
                  onClick={() => {
                    setOpen(false);
                    void copyRssUrl(section, section, variant);
                  }}
                >
                  Copy RSS URL ({variant})
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
