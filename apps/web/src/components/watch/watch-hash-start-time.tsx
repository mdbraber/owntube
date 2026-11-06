"use client";

import { useEffect } from "react";
import { parseStartSeconds } from "@/lib/youtube-url";
import { watchHref } from "@/lib/yt-routes";

/**
 * Old YouTube links carry the start time in the fragment (`/watch?v=…#t=1m30s`),
 * which browsers never send to the server, so neither the middleware nor the
 * watch page can see it. When the page was opened without `?t=`, move a
 * `#t=` / `#start=` fragment into the canonical `?t=<seconds>` URL.
 *
 * A full page load, not `router.replace`: soft navigation from one watch page
 * to another watch page does not commit (the URL never changes).
 */
export function WatchHashStartTime({ videoId }: { videoId: string }) {
  useEffect(() => {
    const hash = window.location.hash;
    if (!/^#(?:t|start)=/.test(hash)) return;
    const t = parseStartSeconds(hash);
    if (t === undefined) return;
    window.location.replace(watchHref(videoId, { t }));
  }, [videoId]);
  return null;
}
