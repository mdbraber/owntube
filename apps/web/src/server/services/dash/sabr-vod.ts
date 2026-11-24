/**
 * VOD through invidious-companion's SABR→DASH connector, behind the
 * `INVIDIOUS_COMPANION_SABR_VOD` switch.
 *
 * The default VOD path (`generate.ts`) builds an MPD from YouTube's byte-range
 * `adaptiveFormats`, which carry the full VP9/AV1 ladder past 1080p. The
 * companion's `/sabr/<id>/manifest.mpd` (our patch; `PATCHES.md` there) instead
 * pulls the video over YouTube's SABR protocol server-side and cuts it into an
 * H.264 + AAC ladder capped at its `SABR_MAX_HEIGHT` (1080 by default). That is
 * the wrong trade while byte-range formats exist, and the right one the day
 * YouTube stops publishing them for VOD — which is what the switch is for:
 *
 *   off       (default) never
 *   fallback  only when the byte-range manifest can't be built
 *   always    SABR first; byte-range formats when the companion can't
 *
 * Like `/dvr` and `/dash/<id>/live`, the browser never sees a companion URL:
 * the template's `init.mp4` / `seg-N.m4s` paths are pointed at
 * `/dash/<id>/sabr/<track>/<file>` on our media origin, proxied per request
 * with a fresh `check=` signature.
 */
import {
  companionSabrUrl,
  withCompanionCheck,
} from "@/server/services/companion";

export type SabrVodMode = "off" | "fallback" | "always";

export function sabrVodMode(): SabrVodMode {
  const raw = (process.env.INVIDIOUS_COMPANION_SABR_VOD ?? "")
    .trim()
    .toLowerCase();
  if (["always", "on", "true", "1"].includes(raw)) return "always";
  if (raw === "fallback") return "fallback";
  return "off";
}

/**
 * The first manifest request makes the companion fetch a player response and
 * index the seed rendition: ~0.1 s on an ANDROID_VR session, ~4 s on WEB+pot
 * (only used when a dubbed audio track is asked for).
 */
const MANIFEST_FETCH_TIMEOUT_MS = 20_000;

/** The connector's segment template, with or without its `?check=` suffix. */
const INIT_RE = /initialization="\$RepresentationID\$\/init\.mp4[^"]*"/g;
const MEDIA_RE = /media="\$RepresentationID\$\/seg-\$Number\$\.m4s[^"]*"/g;
/** The companion advertises captions on its own `/api/v1/captions` route. */
const TEXT_SET_RE =
  /\n?[ \t]*<AdaptationSet contentType="text"[\s\S]*?<\/AdaptationSet>/g;
const VIDEO_REP_RE = /\n?[ \t]*<Representation\b[^>]*\bheight="(\d+)"[^>]*\/>/g;

/**
 * The connector's manifest for a VOD, as served (segment paths relative to the
 * companion). Null when the companion isn't configured, fails, or answers
 * with something other than its own static VOD manifest: for a live or
 * post-live DVR video the same route serves YouTube's dynamic manifest (see
 * `live-manifest.ts`) or redirects to `/api/manifest/dash`, neither of which
 * belongs on this path.
 */
export async function fetchCompanionSabrVodManifest(
  videoId: string,
  audioLang?: string | null,
  videoFamily?: string | null,
): Promise<string | null> {
  const familyParam =
    videoFamily && videoFamily !== "avc" ? `video=${videoFamily}` : null;
  const suffix = [
    audioLang ? `audio=${encodeURIComponent(audioLang)}` : null,
    familyParam,
  ]
    .filter(Boolean)
    .join("&");
  const path = suffix ? `manifest.mpd?${suffix}` : "manifest.mpd";
  const url = companionSabrUrl(videoId, path);
  if (!url) return null;
  try {
    const r = await fetch(withCompanionCheck(url, videoId), {
      cache: "no-store",
      signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) {
      await r.body?.cancel?.();
      return null;
    }
    const mpd = await r.text();
    if (!/<MPD\b[^>]*\btype="static"/.test(mpd)) return null;
    if (!mpd.includes("<Representation")) return null;
    if (!/initialization="\$RepresentationID\$\/init\.mp4/.test(mpd)) {
      return null;
    }
    return mpd;
  } catch {
    return null;
  }
}

/**
 * Point the segment template at `/dash/<id>/sabr/`, replace the companion's
 * caption sets with ours (`captionsXml`, built by `generate.ts` against our
 * own `/captions` route), and drop video rungs above `maxHeight` — unless that
 * would leave none, in which case the ladder is kept whole so playback still
 * works. Null when the manifest carries no template to rewrite.
 */
export function rewriteSabrVodManifest(
  mpd: string,
  videoId: string,
  opts: { maxHeight?: number | null; captionsXml?: string } = {},
): string | null {
  const prefix = `/dash/${encodeURIComponent(videoId)}/sabr/`;
  let inits = 0;
  let medias = 0;
  let out = mpd
    .replace(INIT_RE, () => {
      inits++;
      return `initialization="${prefix}$RepresentationID$/init.mp4"`;
    })
    .replace(MEDIA_RE, () => {
      medias++;
      return `media="${prefix}$RepresentationID$/seg-$Number$.m4s"`;
    });
  if (inits === 0 || medias === 0) return null;

  out = out.replace(TEXT_SET_RE, "");

  const max = opts.maxHeight;
  if (max && Number.isFinite(max)) {
    const heights = [...out.matchAll(VIDEO_REP_RE)].map((m) => Number(m[1]));
    if (heights.some((h) => h <= max)) {
      out = out.replace(VIDEO_REP_RE, (whole, h: string) =>
        Number(h) > max ? "" : whole,
      );
    }
  }

  const captions = opts.captionsXml?.trim();
  if (captions) {
    out = out.replace(
      /\n?([ \t]*)<\/Period>/,
      `\n${opts.captionsXml}\n$1</Period>`,
    );
  }
  return out;
}

/** Signed companion URL for one of the connector's VOD segments. */
export function companionSabrVodSegmentUrl(
  videoId: string,
  track: string,
  file: string,
): string | null {
  const url = companionSabrUrl(
    videoId,
    `${encodeURIComponent(track)}/${encodeURIComponent(file)}`,
  );
  return url ? withCompanionCheck(url, videoId) : null;
}
