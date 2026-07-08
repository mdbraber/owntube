"use client";

import { type ReactNode, useRef, useState } from "react";
import { useVideoActions } from "@/components/videos/use-video-actions";
import {
  VideoActionGlyph,
  type VideoActionSurface,
} from "@/components/videos/video-action-registry";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type SwipeAction = "none" | "queue" | "saved" | "ignore" | "watched";

/** Release before this and the card snaps back; past it, release commits. */
const COMMIT_PX = 120;
const MAX_TRANSLATE = 200;

const ACTION_LABEL: Record<Exclude<SwipeAction, "none">, string> = {
  queue: "Queue",
  saved: "Save",
  ignore: "Ignore",
  watched: "Watched",
};

const ACTION_GLYPH: Record<
  Exclude<SwipeAction, "none">,
  "queue" | "save" | "ignore" | "watched"
> = {
  queue: "queue",
  saved: "save",
  ignore: "ignore",
  watched: "watched",
};

function underlayTone(action: Exclude<SwipeAction, "none">): string {
  // Chip language: destructive = brand, everything else = inverted neutral.
  return action === "ignore"
    ? "bg-[hsl(var(--primary))] text-white"
    : "bg-[hsl(var(--foreground)_/_0.88)] text-[hsl(var(--background))]";
}

/**
 * Wraps a card's *thumbnail* with one swipe action per direction on touch
 * devices (Home / Explore / Subscriptions); the mapping comes from user
 * settings. Only the video frame slides — the solid underlay is revealed
 * behind it with square inner edges (the wrapper clips the outer corners) and
 * the icon + label centered in the revealed strip, popping at the commit
 * threshold. Gestures stay shortcuts: every swipe verb also lives in the
 * kebab menu. `touch-action: pan-y` keeps vertical scrolling intact.
 */
export function CardSwipeLayer({
  videoId,
  title,
  channelId,
  surface = "feed",
  children,
}: {
  videoId: string;
  title: string;
  channelId?: string;
  surface?: VideoActionSurface;
  children: ReactNode;
}) {
  const settings = trpc.settings.get.useQuery();
  const enabled = settings.data?.enableSwipeGestures ?? false;
  const gestures = settings.data?.swipeGestures;

  const actions = useVideoActions({ videoId, channelId, title, surface });

  const startX = useRef<number | null>(null);
  const startY = useRef(0);
  const horizontal = useRef(false);
  // Direction survives release so the underlay keeps its tone while the
  // thumbnail animates back over it.
  const lastDir = useRef<1 | -1>(1);
  const [dx, setDx] = useState(0);

  if (!enabled) return <>{children}</>;

  const dir: 1 | -1 = dx !== 0 ? (dx > 0 ? 1 : -1) : lastDir.current;
  const pendingAction: SwipeAction =
    dir > 0 ? (gestures?.right ?? "none") : (gestures?.left ?? "none");
  const armed = Math.abs(dx) >= COMMIT_PX && pendingAction !== "none";
  const revealPx = Math.min(Math.abs(dx), MAX_TRANSLATE);

  function run(action: SwipeAction) {
    if (action === "queue") actions.toggleQueue(true);
    else if (action === "saved") actions.toggleSave(true);
    else if (action === "ignore") actions.ignoreVideo();
    else if (action === "watched") void actions.markWatched();
  }

  return (
    <div className="relative touch-pan-y overflow-hidden rounded-[var(--radius-card)]">
      {pendingAction !== "none" ? (
        <div
          className={cn(
            // Square edges — the wrapper's rounding clips the outer corners.
            "absolute inset-y-0 z-0 flex items-center justify-center overflow-hidden",
            dir < 0 ? "right-0" : "left-0",
            underlayTone(pendingAction),
          )}
          style={{
            width: revealPx,
            transition: dx ? "none" : "width 160ms ease-out",
          }}
          aria-hidden
        >
          <span
            className={cn(
              "flex flex-col items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-transform duration-100",
              armed && "scale-125",
            )}
          >
            <VideoActionGlyph
              id={ACTION_GLYPH[pendingAction]}
              className="h-5 w-5"
            />
            {ACTION_LABEL[pendingAction]}
          </span>
        </div>
      ) : null}
      <div
        // Solid background + own stacking context so the frame slides *over*
        // the underlay and only uncovers it as it moves; square so the edge
        // against the underlay is straight.
        className="relative z-10 bg-[hsl(var(--background))]"
        style={{
          transform: dx
            ? `translateX(${Math.max(-MAX_TRANSLATE, Math.min(MAX_TRANSLATE, dx))}px)`
            : undefined,
          transition: dx ? "none" : "transform 160ms ease-out",
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          startX.current = t.clientX;
          startY.current = t.clientY;
          horizontal.current = false;
        }}
        onTouchMove={(e) => {
          if (startX.current == null) return;
          const t = e.touches[0];
          if (!t) return;
          const ddx = t.clientX - startX.current;
          const ddy = t.clientY - startY.current;
          if (!horizontal.current && Math.abs(ddx) > Math.abs(ddy) + 6) {
            horizontal.current = true;
          }
          if (horizontal.current) {
            if (ddx !== 0) lastDir.current = ddx > 0 ? 1 : -1;
            setDx(ddx);
          }
        }}
        onTouchEnd={() => {
          const delta = dx;
          if (horizontal.current && Math.abs(delta) >= COMMIT_PX) {
            run(
              delta > 0
                ? (gestures?.right ?? "none")
                : (gestures?.left ?? "none"),
            );
          }
          startX.current = null;
          horizontal.current = false;
          setDx(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
