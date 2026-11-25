"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type RssFeedKind,
  useCopyRssUrl,
} from "@/components/feeds/copy-rss-url";
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
export type FeedSection = "subscriptions" | "favorites" | "tags" | "channel";
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
export function useFeedPagePrefs(
  section: FeedSection,
  /** Off for signed-out visitors (settings need an account): defaults. */
  enabled = true,
): FeedPagePrefs {
  const settings = trpc.settings.get.useQuery(undefined, { enabled });
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
    section === "subscriptions" ||
    section === "favorites" ||
    section === "tags" ||
    section === "channel"
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
  rssFeed,
  buttonClassName,
}: {
  section: OptionsSection;
  /** Feed pages: off where the tab has its own layout (Subscriptions > By tag). */
  showLayout?: boolean;
  /** A feed to offer Copy RSS URL for (e.g. a subscribed channel). */
  rssFeed?: { kind: RssFeedKind; refId: string };
  /** Trigger styling for dark headers (channel banner). */
  buttonClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Portaled to <body> and fixed to the viewport (below the trigger, right-
  // aligned) so a header that clips overflow or creates a containing block
  // (the channel banner's backdrop blur) can't cut it off.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null,
  );
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setOpen(true);
  };
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
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A fixed popover doesn't follow the trigger: close rather than drift.
    const onMove = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
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
    channel: { ...DEFAULT_FEED_PREFS, hideIgnored: false },
  };
  const current = prefs[section];
  // Queue, Saved and Subscriptions publish as fixed slugs; a channel page
  // passes its feed (only once subscribed). History, Favorites, tags: none.
  const feedToCopy: { kind: RssFeedKind; refId: string } | undefined =
    rssFeed ??
    (section === "queue" || section === "saved" || section === "subscriptions"
      ? { kind: section, refId: section }
      : undefined);

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
        className={
          buttonClassName ??
          "flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        }
        title="Page options"
        aria-label="Page options"
        aria-expanded={open}
        onClick={toggle}
      >
        <MoreIcon className="h-5 w-5" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-50 max-h-[calc(100vh-5rem)] w-64 overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm text-[hsl(var(--foreground))] shadow-lg"
              style={anchor ?? undefined}
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
                    (layout) => (layout === "cards" ? "Cards" : "List"),
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
                  {/* Channel pages keep Shorts on their own tab. */}
                  {section !== "channel"
                    ? checkbox("Hide Shorts", feedPrefs.hideShorts, (v) =>
                        patch({ hideShorts: v }),
                      )
                    : null}
                  {checkbox("Hide ignored videos", feedPrefs.hideIgnored, (v) =>
                    patch({ hideIgnored: v }),
                  )}
                </>
              ) : null}
              {feedToCopy
                ? (["audio", "video"] as const).map((variant) => (
                    <button
                      key={variant}
                      type="button"
                      role="menuitem"
                      className="mt-1 w-full rounded-lg px-1 py-2 text-left transition hover:bg-[hsl(var(--muted)_/_0.65)]"
                      onClick={() => {
                        setOpen(false);
                        void copyRssUrl(
                          feedToCopy.kind,
                          feedToCopy.refId,
                          variant,
                        );
                      }}
                    >
                      Copy RSS URL ({variant})
                    </button>
                  ))
                : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
