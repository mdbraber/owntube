"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { parseStartSeconds } from "@/lib/youtube-url";
import { watchHref } from "@/lib/yt-routes";

/**
 * Old YouTube links carry the start time in the fragment (`/watch?v=…#t=1m30s`),
 * which browsers never send to the server, so neither the middleware nor the
 * watch page can see it. When the page was opened without `?t=`, move a
 * `#t=` / `#start=` fragment into the canonical `?t=<seconds>` URL.
 */
export function WatchHashStartTime({ videoId }: { videoId: string }) {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash;
    if (!/^#(?:t|start)=/.test(hash)) return;
    const t = parseStartSeconds(hash);
    if (t === undefined) return;
    router.replace(watchHref(videoId, { t }));
  }, [router, videoId]);
  return null;
}
