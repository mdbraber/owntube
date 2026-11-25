"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { postToNativeApp } from "@/lib/native-app";

const QUEUE_KEY = "ot:watch-queue";

/**
 * The page title without the site name the root layout's title template adds
 * ("Trending · owntube" → "Trending"); empty for the bare default title, so the
 * native navigation bar keeps its own.
 */
export function nativePageTitle(documentTitle: string): string {
  const parts = documentTitle.split(" · ");
  return parts.length > 1 ? parts.slice(0, -1).join(" · ").trim() : "";
}

/**
 * Keeps the iOS app's native shell in step with the page: its title and URL
 * for the navigation bar (also after client-side navigations, which the
 * WebView doesn't report reliably), and the watch queue for the home-screen
 * widget. Rendered only inside the app (see `isNativeAppUserAgent`).
 */
export function NativeAppBridge() {
  const pathname = usePathname();

  useEffect(() => {
    // `pathname` re-runs this on every navigation; the title is read when it
    // changes, as Next.js sets it after the new route renders.
    void pathname;
    const send = () =>
      postToNativeApp({
        type: "page",
        title: nativePageTitle(document.title),
        url: window.location.href,
      });
    send();
    const observer = new MutationObserver(send);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    // `pageshow` covers going back to a page restored from the back-forward
    // cache, where no script re-runs.
    window.addEventListener("popstate", send);
    window.addEventListener("pageshow", send);
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", send);
      window.removeEventListener("pageshow", send);
    };
  }, [pathname]);

  useEffect(() => {
    // QueueSync and the player keep localStorage[QUEUE_KEY] current and fire
    // `ot:watch-queue-updated`; `storage` covers the app's other tabs.
    const send = () => {
      try {
        postToNativeApp({
          type: "queue",
          raw: localStorage.getItem(QUEUE_KEY) ?? "[]",
        });
      } catch {}
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === QUEUE_KEY) send();
    };
    send();
    window.addEventListener("ot:watch-queue-updated", send);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ot:watch-queue-updated", send);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
