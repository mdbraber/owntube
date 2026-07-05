"use client";

import { useEffect } from "react";
import { trpc } from "@/trpc/react";

const STORAGE_KEY = "ot:watch-queue";

/**
 * Mirrors the server-backed queue into localStorage["ot:watch-queue"] (the
 * shape the player's Up-next and the iOS widget read: [{ href, title }]). The
 * server is the source of truth; this keeps the local cache in step and fires
 * `ot:watch-queue-updated` so the iOS shell mirrors it into the App Group.
 *
 * Also listens for `ot:queue-consume` (dispatched by the player when autoplay
 * advances to the next item) and removes that video from the server queue.
 */
export function QueueSync() {
  const utils = trpc.useUtils();
  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const list = trpc.queue.list.useQuery(undefined, { enabled: authed });
  const remove = trpc.queue.remove.useMutation({
    onSettled: () => utils.queue.list.invalidate(),
  });

  useEffect(() => {
    if (!authed) {
      try {
        if (localStorage.getItem(STORAGE_KEY)) {
          localStorage.setItem(STORAGE_KEY, "[]");
          window.dispatchEvent(new CustomEvent("ot:watch-queue-updated"));
        }
      } catch {}
      return;
    }
    if (!list.data) return;
    try {
      const mapped = list.data.map((i) => ({ href: i.href, title: i.title }));
      const next = JSON.stringify(mapped);
      if (localStorage.getItem(STORAGE_KEY) !== next) {
        localStorage.setItem(STORAGE_KEY, next);
        window.dispatchEvent(new CustomEvent("ot:watch-queue-updated"));
      }
    } catch {}
  }, [authed, list.data]);

  useEffect(() => {
    if (!authed) return;
    function onConsume(e: Event) {
      const vid = (e as CustomEvent<{ videoId?: string }>).detail?.videoId;
      if (typeof vid === "string" && vid) remove.mutate({ videoId: vid });
    }
    window.addEventListener("ot:queue-consume", onConsume);
    return () => window.removeEventListener("ot:queue-consume", onConsume);
  }, [authed, remove]);

  return null;
}
