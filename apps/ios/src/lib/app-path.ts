import { appPathFromYoutubeUrl } from "@web/lib/youtube-url";
import { SERVER_ORIGIN } from "@/lib/config";

/**
 * The web path a URL handed to the app opens, or null when it isn't ours:
 *
 *   owntube://watch?v=<id>     → /watch?v=<id>     (widget, Top Shelf shape)
 *   owntube://watch/<id>       → /watch/<id>       (Privacy Redirect shape)
 *   owntube://channel/<id>     → /channel/<id>
 *   https://youtu.be/<id>, https://www.youtube.com/… → the OwnTube page
 *   <server>/<path>            → /<path>
 *
 * YouTube-shaped paths are left as they are: the web middleware already
 * redirects every one of them to its canonical OwnTube page
 * (`apps/web/src/lib/youtube-url.ts`), so the app needn't know them.
 */
export function appPathFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === "owntube:") {
    // owntube://watch?v=… parses with "watch" as the host.
    const path = [url.host, ...url.pathname.split("/")]
      .filter(Boolean)
      .join("/");
    return `/${path}${url.search}`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin === SERVER_ORIGIN) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return appPathFromYoutubeUrl(raw);
}
