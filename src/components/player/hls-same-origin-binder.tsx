"use client";

import { useMediaProvider } from "@vidstack/react";
import { useLayoutEffect } from "react";
import { applyHlsSameOriginToVidstackProvider } from "@/lib/hls-same-origin";

/** Must render inside `<MediaPlayer>` — sets hls.js config before the instance is built. */
export function HlsSameOriginBinder() {
  const provider = useMediaProvider();

  useLayoutEffect(() => {
    applyHlsSameOriginToVidstackProvider(provider);
  }, [provider]);

  return null;
}
