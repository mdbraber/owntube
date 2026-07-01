"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type AddToQueueButtonProps = {
  href: string;
  title: string;
};

const WATCH_QUEUE_STORAGE_KEY = "ot:watch-queue";

type WatchQueueItem = { href: string; title: string };

function readWatchQueue(): WatchQueueItem[] {
  try {
    const raw = window.localStorage.getItem(WATCH_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is WatchQueueItem =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { href?: unknown }).href === "string" &&
          typeof (item as { title?: unknown }).title === "string",
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

function writeWatchQueue(items: WatchQueueItem[]): void {
  try {
    window.localStorage.setItem(WATCH_QUEUE_STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("ot:watch-queue-updated"));
  } catch {}
}

export function AddToQueueButton({ href, title }: AddToQueueButtonProps) {
  const [added, setAdded] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-[11px] text-[hsl(var(--muted-foreground))]"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const queue = readWatchQueue();
        if (!queue.some((item) => item.href === href)) {
          writeWatchQueue([...queue, { href, title }]);
        }
        setAdded(true);
        window.setTimeout(() => setAdded(false), 1200);
      }}
      title="Add to queue"
    >
      {added ? "Added" : "Add to queue"}
    </Button>
  );
}
