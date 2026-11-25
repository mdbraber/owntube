import * as Linking from "expo-linking";
import { router, useRootNavigationState } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { appPathFromUrl } from "@/lib/app-path";

/** A web path to open in the Home tab, with a serial so repeats still open. */
export type PendingLink = { path: string; serial: number };

let pending: PendingLink | null = null;
let serial = 0;
const listeners = new Set<() => void>();

/** Opens a web page in the Home tab (deep links, quick actions). */
export function openInHome(path: string) {
  serial += 1;
  pending = { path, serial };
  for (const listener of listeners) listener();
  router.navigate("/");
}

/** The latest link to open in the Home tab (read by the Home screen). */
export function usePendingLink(): PendingLink | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
}

/**
 * Opens every URL handed to the app (owntube:// links from the widget or
 * Privacy Redirect, YouTube links) in the Home tab: the one launching the app
 * and each one arriving while it runs. Mounted once, in the root layout.
 */
export function useIncomingLinks() {
  const ready = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (!ready) return;
    const open = (url: string | null) => {
      const path = url ? appPathFromUrl(url) : null;
      if (path && path !== "/") openInHome(path);
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", ({ url }) =>
      open(url),
    );
    return () => subscription.remove();
  }, [ready]);
}
