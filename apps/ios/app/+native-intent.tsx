import { appPathFromUrl } from "@/lib/app-path";

/**
 * Every URL that opens the app (owntube:// links from the widget or Privacy
 * Redirect, YouTube links) opens its page as a new screen in the Home tab,
 * on launch and while running. The key makes a repeated link open again.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  const appPath = appPathFromUrl(path);
  if (!appPath || appPath === "/") return "/";
  return `/page?path=${encodeURIComponent(appPath)}&k=${Date.now()}`;
}
