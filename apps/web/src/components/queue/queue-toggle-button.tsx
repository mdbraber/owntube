"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

type QueueToggleButtonProps = {
  videoId: string;
  title: string;
  channelId?: string;
  /** "player" = fancy pill (replaces Save); "card" = compact ghost text. */
  variant?: "player" | "card";
};

function QueueIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 6h11M4 12h11M4 18h7M17 15v6M20 18h-6" />
    </svg>
  );
}

function QueuedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 6h11M4 12h11M4 18h7M15 18l2 2 4-4" />
    </svg>
  );
}

export function QueueToggleButton({
  videoId,
  title,
  channelId,
  variant = "player",
}: QueueToggleButtonProps) {
  const utils = trpc.useUtils();
  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const listQuery = trpc.queue.list.useQuery(undefined, { enabled: authed });
  const queued = listQuery.data?.some((i) => i.videoId === videoId) ?? false;

  const invalidate = () => utils.queue.list.invalidate();

  const add = trpc.queue.add.useMutation({
    onMutate: async () => {
      await utils.queue.list.cancel();
      const prev = utils.queue.list.getData();
      utils.queue.list.setData(undefined, (old) => [
        ...(old ?? []),
        {
          videoId,
          title,
          channelId: channelId ?? null,
          position: old?.length ?? 0,
          addedAt: Math.floor(Date.now() / 1000),
          href: `/watch/${videoId}`,
        },
      ]);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.queue.list.setData(undefined, ctx.prev);
    },
    onSettled: invalidate,
  });

  const remove = trpc.queue.remove.useMutation({
    onMutate: async () => {
      await utils.queue.list.cancel();
      const prev = utils.queue.list.getData();
      utils.queue.list.setData(undefined, (old) =>
        (old ?? []).filter((i) => i.videoId !== videoId),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.queue.list.setData(undefined, ctx.prev);
    },
    onSettled: invalidate,
  });

  const isPending = add.isPending || remove.isPending;
  const toggle = () => {
    if (!authed) return;
    if (queued) remove.mutate({ videoId });
    else add.mutate({ videoId, title, channelId });
  };

  // Cards don't show the control to signed-out users; the player shows it disabled.
  if (!authed && variant === "card") return null;

  if (variant === "card") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px] text-[hsl(var(--muted-foreground))]"
        title={queued ? "Remove from queue" : "Add to queue"}
        disabled={isPending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
      >
        {queued ? "Unqueue" : "Queue"}
      </Button>
    );
  }

  const fancyButtonClass =
    "group relative overflow-hidden rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]";

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        fancyButtonClass,
        queued
          ? "border-sky-500/45 bg-sky-500/15 text-sky-600 dark:text-sky-400"
          : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-sky-400/50 hover:bg-sky-500/10",
      )}
      disabled={!authed || isPending}
      onClick={toggle}
    >
      <span
        className={cn(
          "transition-transform duration-200 group-hover:scale-110",
          queued ? "animate-[ot-pop_250ms_ease-out]" : "",
        )}
        aria-hidden="true"
      >
        {queued ? <QueuedIcon /> : <QueueIcon />}
      </span>
      <span>{queued ? "Unqueue" : "Queue"}</span>
    </Button>
  );
}
