import { type NextRequest, NextResponse } from "next/server";
import { canonicalYoutubePath } from "@/lib/youtube-url";

/**
 * URL compatibility layer: OwnTube's canonical URLs are YouTube's own
 * (`/watch?v=…`, `/playlist?list=…`, `/channel/UC…`). This middleware redirects
 * every other inbound shape — whatever YouTube URLs look like in the wild, and
 * OwnTube's own former path-style URLs (kept working for old bookmarks / stored
 * history & queue rows) — to those canonical forms, so there is exactly one URL
 * per resource. The rules live in `lib/youtube-url.ts`, shared with the watch
 * page.
 */
export function middleware(req: NextRequest): NextResponse {
  const url = req.nextUrl;
  const target = canonicalYoutubePath(url.pathname, url.search);
  if (target === null) return NextResponse.next();
  const to = url.clone();
  const queryAt = target.indexOf("?");
  to.pathname = queryAt < 0 ? target : target.slice(0, queryAt);
  to.search = queryAt < 0 ? "" : target.slice(queryAt);
  return NextResponse.redirect(to, 308);
}

export const config = {
  // Skip Next internals, API/proxy routes (incl. high-traffic media segments),
  // and static asset files.
  matcher: [
    "/((?!_next/|api/|invidious/|hls/|dash/|media/|captions/|yt-hls|channel-avatar|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
