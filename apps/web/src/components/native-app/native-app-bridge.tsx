"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  NATIVE_APP_COMMAND_EVENT,
  parseNativeAppCommand,
  postToNativeApp,
} from "@/lib/native-app";
import { trpc } from "@/trpc/react";

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

  useNativeAppSession();

  return null;
}

/**
 * The app's own API session follows the page's sign-in: the page reports who
 * is signed in, and approves the device pairing the app starts to get a token
 * for that account (see apps/ios/src/lib/session.ts).
 */
function useNativeAppSession() {
  const authed = trpc.auth.session.useQuery().data?.authed;
  const me = trpc.auth.me.useQuery(undefined, { enabled: authed === true });
  const approve = trpc.auth.approveDevicePairing.useMutation();
  const approveRef = useRef(approve.mutateAsync);
  approveRef.current = approve.mutateAsync;

  const userId = authed === false ? null : (me.data?.id ?? undefined);
  useEffect(() => {
    if (userId !== undefined) postToNativeApp({ type: "session", userId });
  }, [userId]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = parseNativeAppCommand((event as CustomEvent).detail);
      if (command?.type !== "approvePairing") return;
      const { userCode } = command;
      approveRef
        .current({ userCode })
        .then(
          (result) => result.status === "approved",
          () => false,
        )
        .then((ok) =>
          postToNativeApp({ type: "pairingApproved", userCode, ok }),
        );
    };
    window.addEventListener(NATIVE_APP_COMMAND_EVENT, onCommand);
    return () =>
      window.removeEventListener(NATIVE_APP_COMMAND_EVENT, onCommand);
  }, []);
}
