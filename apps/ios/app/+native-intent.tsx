import { isVideoId, parseStartSeconds } from "@web/lib/youtube-url";
import { appPathFromUrl } from "@/lib/app-path";

/**
 * Every URL that opens the app (owntube:// links from the widget or Privacy
 * Redirect, YouTube links), on launch and while running: a video opens in the
 * player panel; any other page as a new screen in the Home tab (the key makes
 * a repeated link open again).
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  const appPath = appPathFromUrl(path);
  if (!appPath || appPath === "/") return "/";
  const url = new URL(appPath, "https://owntube.invalid");
  const videoId =
    url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.match(/^\/watch\/([^/]+)/)?.[1];
  if (videoId && isVideoId(videoId)) {
    const start = parseStartSeconds(url.searchParams.get("t"));
    return `/player?v=${videoId}${start ? `&t=${start}` : ""}`;
  }
  return `/page?path=${encodeURIComponent(appPath)}&k=${Date.now()}`;
}
