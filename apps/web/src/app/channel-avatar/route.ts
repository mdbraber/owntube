import {
  collectAllowedChannelAvatarOrigins,
  isAllowedChannelAvatarFetchTarget,
} from "@/lib/channel-avatar-proxy";
import { getCachedAsset } from "@/server/assets/cache";

const MAX_TARGET_URL_LEN = 8_192;

/**
 * Same-origin hop for channel avatars from self-hosted Piped/Invidious LAN URLs.
 * HTTPS OwnTube (reverse proxy) cannot load HTTP upstream images directly.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) {
    return new Response("missing url", { status: 400 });
  }
  if (raw.length > MAX_TARGET_URL_LEN) {
    return new Response("url too long", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("invalid url", { status: 400 });
  }

  if (!isAllowedChannelAvatarFetchTarget(target)) {
    return new Response("host not allowed", { status: 403 });
  }

  if (collectAllowedChannelAvatarOrigins().length === 0) {
    return new Response("upstream not configured", { status: 503 });
  }

  const forwardHeaders: Record<string, string> = {
    "user-agent": "OwnTube/0.1",
    accept: "image/*,*/*;q=0.8",
  };
  const fetchUpstream = () =>
    fetch(target.toString(), {
      headers: forwardHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

  // Disk asset cache (serve-stale-and-revalidate); pass-through on refusal.
  const asset = await getCachedAsset(target.toString(), "avatar", fetchUpstream);
  if (asset) {
    return new Response(new Uint8Array(asset.body), {
      status: 200,
      headers: {
        "content-type": asset.contentType,
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-length": String(asset.body.byteLength),
      },
    });
  }

  const r = await fetchUpstream();

  if (!r.ok) {
    return new Response(r.body, {
      status: r.status,
      statusText: r.statusText,
    });
  }

  const contentType = r.headers.get("content-type") ?? "image/jpeg";

  return new Response(r.body, {
    status: r.status,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
