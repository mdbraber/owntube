"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActionToast } from "@/components/videos/action-toast";
import { MoreIcon } from "@/components/videos/video-action-icons";
import { trpc } from "@/trpc/react";

export type RssFeedKind =
  | "playlist"
  | "queue"
  | "saved"
  | "subscriptions"
  | "tag"
  | "channel";

export type RssFeedVariant = "audio" | "video";

/**
 * Copy a feed's secret address to the clipboard, in the chosen
 * enclosure variant. The URL comes from the slugs the publisher recorded on
 * its last run, so a brand-new or still-empty feed reports "not published
 * yet" instead.
 */
export function useCopyRssUrl(): (
  kind: RssFeedKind,
  refId: string,
  variant: RssFeedVariant,
) => Promise<void> {
  const utils = trpc.useUtils();
  const { showToast } = useActionToast();
  return async (kind, refId, variant) => {
    try {
      const res = await utils.settings.rssFeedUrl.fetch({ kind, refId });
      const url = variant === "audio" ? res.audioUrl : res.videoUrl;
      if (!url) {
        showToast(
          res.reason === "not-published"
            ? "Not published yet — try again in a minute"
            : "No feed server configured",
        );
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast(`RSS ${variant} feed URL copied`);
    } catch {
      showToast("Could not copy the RSS URL");
    }
  };
}

/**
 * "Copy RSS URL" with an audio/video chooser. Default styling suits page
 * headers on the standard background; pass buttonClassName to restyle the
 * trigger (e.g. the playlist header's white-on-brand pill), or
 * trigger="more" to tuck it behind a ⋯ button where it needn't be prominent.
 *
 * The chooser is portalled and fixed-positioned so a clipping ancestor (the
 * channel banner's overflow-hidden, content-visibility rows) can't hide it;
 * it opens below the trigger, or above when there's no room below.
 */
export function CopyRssUrlButton({
  kind,
  refId,
  buttonClassName,
  trigger = "label",
}: {
  kind: RssFeedKind;
  refId: string;
  buttonClassName?: string;
  trigger?: "label" | "more";
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const open = menuPos !== null;
  const copyRssUrl = useCopyRssUrl();

  useEffect(() => {
    if (!open) return;
    const close = () => setMenuPos(null);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Fixed position doesn't follow the trigger; close rather than drift.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (open || !buttonRef.current) {
      setMenuPos(null);
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    // Right-aligned to the trigger, but kept on screen: on narrow viewports
    // the trigger can wrap to the left edge.
    const width = trigger === "more" ? 224 : 160;
    const left = Math.min(
      Math.max(8, rect.right - width),
      window.innerWidth - width - 8,
    );
    const below = window.innerHeight - rect.bottom;
    setMenuPos(
      below < MENU_HEIGHT_PX && rect.top > below
        ? { left, width, bottom: window.innerHeight - rect.top + 4 }
        : { left, width, top: rect.bottom + 4 },
    );
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={trigger === "more" ? "More options" : undefined}
        title={trigger === "more" ? "More options" : undefined}
        onClick={toggle}
        className={
          buttonClassName ??
          (trigger === "more"
            ? "flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            : "rounded-full border border-[hsl(var(--border))] px-4 py-1.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]")
        }
      >
        {trigger === "more" ? <MoreIcon className="h-5 w-5" /> : "Copy RSS URL"}
      </button>
      {menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={menuPos}
              className="fixed z-50 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1 text-sm font-normal shadow-lg"
            >
              {(["audio", "video"] as const).map((variant) => (
                <button
                  key={variant}
                  type="button"
                  role="menuitem"
                  className="w-full rounded-lg px-2 py-1.5 text-left text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted)_/_0.65)]"
                  onClick={() => {
                    setMenuPos(null);
                    void copyRssUrl(kind, refId, variant);
                  }}
                >
                  {trigger === "more"
                    ? `Copy RSS URL (${variant})`
                    : variant === "audio"
                      ? "Audio feed"
                      : "Video feed"}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type MenuPos = { left: number; width: number; top?: number; bottom?: number };

/** Roughly the two-item chooser's height, to decide whether it fits below. */
const MENU_HEIGHT_PX = 96;
