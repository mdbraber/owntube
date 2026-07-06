"use client";

import { type ReactNode, useRef, useState } from "react";
import { useIgnoredVideos } from "@/components/videos/ignored-videos-context";
import { trpc } from "@/trpc/react";

type SwipeAction = "none" | "queue" | "saved" | "ignore" | "watched";

const SHORT_PX = 90;
const LONG_PX = 240;
const MAX_TRANSLATE = 320;

const ACTION_LABEL: Record<SwipeAction, string> = {
  none: "",
  queue: "Queue",
  saved: "Save",
  ignore: "Ignore",
  watched: "Watched",
};

/**
 * Wraps a video card with configurable left/right short/long swipe gestures on
 * touch devices (Home / Explore / Subscriptions). The mapping comes from user
 * settings; `touch-action: pan-y` lets horizontal swipes be captured here while
 * vertical scrolling still works.
 */
export function CardSwipeLayer({
  videoId,
  title,
  channelId,
  children,
}: {
  videoId: string;
  title: string;
  channelId?: string;
  children: ReactNode;
}) {
  const settings = trpc.settings.get.useQuery();
  const enabled = settings.data?.enableSwipeGestures ?? false;
  const gestures = settings.data?.swipeGestures;

  const utils = trpc.useUtils();
  const { ignore } = useIgnoredVideos();
  const queueAdd = trpc.queue.add.useMutation({
    onSettled: () => utils.queue.list.invalidate(),
  });
  const setInteraction = trpc.interactions.set.useMutation();
  const markWatched = trpc.subscriptions.markWatched.useMutation({
    onSettled: () => {
      utils.subscriptions.mergedFeedInfinite.invalidate();
      utils.feed.home.invalidate();
      utils.history.list.invalidate();
    },
  });

  const startX = useRef<number | null>(null);
  const startY = useRef(0);
  const horizontal = useRef(false);
  const [dx, setDx] = useState(0);

  function actionFor(delta: number): SwipeAction {
    if (!gestures) return "none";
    const long = Math.abs(delta) >= LONG_PX;
    if (delta < 0) return long ? gestures.longLeft : gestures.shortLeft;
    return long ? gestures.longRight : gestures.shortRight;
  }

  function run(action: SwipeAction) {
    if (action === "queue") queueAdd.mutate({ videoId, title, channelId });
    else if (action === "saved")
      setInteraction.mutate({
        videoId,
        channelId,
        type: "save",
        active: true,
        title,
      });
    else if (action === "ignore") ignore(videoId, channelId);
    else if (action === "watched") markWatched.mutate({ videoId, channelId });
  }

  if (!enabled) return <>{children}</>;

  const pending = Math.abs(dx) >= SHORT_PX ? actionFor(dx) : "none";

  return (
    <div className="relative touch-pan-y overflow-hidden rounded-[var(--radius-card)]">
      {pending !== "none" ? (
        <div
          className={`pointer-events-none absolute inset-y-0 z-10 flex items-center rounded-[var(--radius-card)] px-4 text-xs font-bold uppercase tracking-wide text-white ${
            dx < 0
              ? "right-0 justify-end bg-gradient-to-l"
              : "left-0 justify-start bg-gradient-to-r"
          } ${
            pending === "ignore"
              ? "from-red-600/80"
              : pending === "watched"
                ? "from-zinc-600/80"
                : pending === "saved"
                  ? "from-emerald-600/80"
                  : "from-sky-600/80"
          } to-transparent`}
          style={{ width: MAX_TRANSLATE }}
        >
          {ACTION_LABEL[pending]}
        </div>
      ) : null}
      <div
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
          if (horizontal.current) setDx(ddx);
        }}
        onTouchEnd={() => {
          const delta = dx;
          if (horizontal.current && Math.abs(delta) >= SHORT_PX) {
            run(actionFor(delta));
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
