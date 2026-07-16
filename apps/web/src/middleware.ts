import { type NextRequest, NextResponse } from "next/server";

/**
 * URL compatibility layer: OwnTube's canonical URLs are YouTube's own
 * (`/watch?v=…`, `/playlist?list=…`, `/channel/UC…`). This middleware redirects
 * every other inbound shape — YouTube's alternates and OwnTube's own former
 * path-style URLs (kept working for old bookmarks / stored history & queue
 * rows) — to those canonical forms, so there is exactly one URL per resource.
 */

/** Single-video YouTube URL prefixes that map to `/watch?v=<id>`. */
const VIDEO_PREFIXES = new Set(["shorts", "embed", "live", "v"]);

export function middleware(req: NextRequest): NextResponse {
  const url = req.nextUrl;
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  const second = segments[1];

  // Former OwnTube video path:  /watch/<id>[?t=] -> /watch?v=<id>[&t=]
  if (first === "watch" && second) {
    const to = url.clone();
    to.pathname = "/watch";
    to.searchParams.set("v", second);
    return NextResponse.redirect(to, 308);
  }

  // YouTube single-video shapes:  /shorts|embed|live|v/<id> -> /watch?v=<id>
  if (first && second && VIDEO_PREFIXES.has(first)) {
    const t = url.searchParams.get("t") ?? url.searchParams.get("start");
    const to = url.clone();
    to.pathname = "/watch";
    to.search = "";
    to.searchParams.set("v", second);
    if (t) to.searchParams.set("t", t.replace(/s$/, ""));
    return NextResponse.redirect(to, 308);
  }

  // Former OwnTube playlist path:  /playlist/<id> -> /playlist?list=<id>
  if (first === "playlist" && second) {
    const to = url.clone();
    to.pathname = "/playlist";
    to.searchParams.set("list", second);
    return NextResponse.redirect(to, 308);
  }

  // Channel handle / custom / user URLs -> /channel/<token>; the channel service
  // resolves the token (@handle, custom or user name) to a UC id.
  //   /@handle[/tab]   -> /channel/@handle
  //   /c/Name[/tab]    -> /channel/Name
  //   /user/Name[/tab] -> /channel/Name
  if (first && first.startsWith("@") && first.length > 1) {
    const to = url.clone();
    to.pathname = `/channel/${first}`;
    to.search = "";
    return NextResponse.redirect(to, 308);
  }
  if ((first === "c" || first === "user") && second) {
    const to = url.clone();
    to.pathname = `/channel/${second}`;
    to.search = "";
    return NextResponse.redirect(to, 308);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, API/proxy routes (incl. high-traffic media segments),
  // and static asset files.
  matcher: [
    "/((?!_next/|api/|invidious/|hls/|dash/|captions/|yt-hls|channel-avatar|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
