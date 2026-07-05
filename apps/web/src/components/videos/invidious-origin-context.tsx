"use client";

import { createContext, useContext } from "react";

/**
 * Origins of the configured Invidious instance, computed server-side from
 * `INVIDIOUS_BASE_URL` and injected here so the browser can make the same
 * `/invidious/…` proxy decision the server made — without reading any env var
 * client-side (which would be `undefined` in the bundle and cause a hydration
 * mismatch). See {@link toBrowserUpstreamImageUrl}.
 */
const InvidiousOriginContext = createContext<readonly string[]>([]);

export function InvidiousOriginProvider({
  origins,
  children,
}: {
  origins: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <InvidiousOriginContext.Provider value={origins}>
      {children}
    </InvidiousOriginContext.Provider>
  );
}

/** Invidious origins to pass into the browser image-URL builders. */
export function useInvidiousOrigins(): readonly string[] {
  return useContext(InvidiousOriginContext);
}
