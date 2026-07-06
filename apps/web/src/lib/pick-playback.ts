import {
  audioTrackLanguageInfo,
  languageFirstAudioMenuLabel,
  streamLooksLikeOriginalAudio,
} from "@/lib/audio-track-label";
import { reorderVariantsForDefaultQuality } from "@/lib/default-playback-quality";
import { isPipedHostedProgressiveUrl } from "@/lib/upstream-playback-catalog";
import type { VideoDetail } from "@/server/services/proxy.types";

type VideoStreamSource = VideoDetail["videoSources"][number];

/**
 * `video/*` with a codecs="…" clause that lists only audio codecs (bad rows).
 */
function mimeVideoTypeButAudioOnlyCodecs(mime: string | undefined): boolean {
  if (!mime?.trim()) return false;
  if (!mime.toLowerCase().startsWith("video/")) return false;
  const m = mime.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!m?.[1]) return false;
  const c = m[1].toLowerCase().replace(/\s/g, "");
  if (/avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(c)) return false;
  return /mp4a|opus|vorbis|flac/.test(c);
}

/**
 * `video/*` rows with codecs that contain a video codec but no audio codec:
 * these are effectively video-only and can produce silent playback if treated
 * as combined muxed sources.
 */
function mimeVideoTypeWithoutAudioCodecs(mime: string | undefined): boolean {
  if (!mime?.trim()) return false;
  if (!mime.toLowerCase().startsWith("video/")) return false;
  const m = mime.match(/codecs\s*=\s*"([^"]+)"/i);
  if (!m?.[1]) return false;
  const c = m[1].toLowerCase().replace(/\s/g, "");
  const hasVideo = /avc1|avc3|av01|vp8|vp9|vp09|hev1|hvc1|dvh1|theora/.test(c);
  const hasAudio = /mp4a|opus|vorbis|flac|ac-3|ec-3/.test(c);
  return hasVideo && !hasAudio;
}

function streamIsVideoOnly(s: VideoStreamSource): boolean {
  if (s.videoOnly === true) return true;
  return mimeVideoTypeWithoutAudioCodecs(s.mimeType);
}

function scoreNativeVideoCodec(s: VideoStreamSource): number {
  const blob = `${s.mimeType ?? ""} ${s.url ?? ""}`.toLowerCase();
  if (/avc1|avc3|h264/.test(blob)) return 100;
  if (/video\/mp4/.test(blob) && !/av01|av1|vp9|webm/.test(blob)) return 80;
  if (/vp9|video\/webm/.test(blob)) return 50;
  if (/av01|av1/.test(blob)) return 10;
  return 40;
}

/**
 * Rows we can offer as a &lt;video&gt; source: drop pure audio MIME, height 0,
 * and mis-tagged video/* streams whose codecs are audio-only.
 */
function sourceLooksLikeVideoPane(s: VideoStreamSource): boolean {
  const mt = s.mimeType?.toLowerCase() ?? "";
  if (mt.startsWith("audio/")) return false;
  if (
    typeof s.height === "number" &&
    Number.isFinite(s.height) &&
    s.height <= 0
  ) {
    // Piped legacy muxed itag 18 often reports height: 0 — still has video.
    if (!streamIsVideoOnly(s)) {
      if (mt.startsWith("video/") || (s.quality && !/audio/i.test(s.quality))) {
        return true;
      }
    }
    return false;
  }
  if (mimeVideoTypeButAudioOnlyCodecs(s.mimeType)) return false;
  return true;
}

function isDashPath(url: string): boolean {
  const l = url.toLowerCase();
  return (
    l.includes("/manifest/dash/") ||
    l.includes("/api/manifest/dash") ||
    l.includes(".mpd")
  );
}

function isHlsPath(url: string): boolean {
  const l = url.toLowerCase();
  return l.includes(".m3u8") || l.includes("/manifest/hls/");
}

/** Higher = better; used to sort (best first). */
function scoreQualityLabel(quality: string | undefined, index: number): number {
  if (!quality) return index;
  const m = quality.match(/(\d{2,4})\s*p/i);
  if (m) {
    return Number.parseInt(m[1] ?? "0", 10) * 1_000_000;
  }
  if (/^(tiny|144p|small)/i.test(quality)) return 1;
  if (/^(light|low|240p|360p|medium|480p)/i.test(quality)) return 2;
  if (/^(hd720|large|hd|720p)/i.test(quality)) return 3;
  if (/^(hd1080|hd1080|1080p|fhd)/i.test(quality)) return 4;
  if (/^(1440p|hd1440|qhd)/i.test(quality)) return 5;
  if (/^(2160p|4k|hd2160|uhd|4320p)/i.test(quality)) return 6;
  return 0;
}

function labelForStream(
  quality: string | undefined,
  mimeType: string | undefined,
  index: number,
): string {
  if (quality?.trim()) return quality.trim();
  if (mimeType?.includes("audio")) return `Audio ${index + 1}`;
  return `Format ${index + 1}`;
}

function scoreMuxed(quality: string | undefined, index: number) {
  return scoreQualityLabel(quality, index);
}

export type MuxedVariant = {
  t: "muxed";
  url: string;
  label: string;
  /** Used only before dedupe (source bitrate, bps); stripped from output. */
  rankBitrate?: number;
};
export type SplitVariant = {
  t: "split";
  videoUrl: string;
  audioUrl: string;
  label: string;
  audioOptions: { url: string; label: string }[];
  /** Index into `audioOptions` for the default track (original when known). */
  defaultAudioIndex?: number;
  rankBitrate?: number;
};
export type PlayableVariant = MuxedVariant | SplitVariant;

type PlayableWithRank = PlayableVariant & { rankBitrate?: number };

function rankBitrateOf(v: PlayableWithRank): number {
  const br = v.rankBitrate;
  return typeof br === "number" && Number.isFinite(br) ? br : 0;
}

function omitRankBitrate(v: PlayableWithRank): PlayableVariant {
  if (v.t === "muxed") {
    const { rankBitrate: _r, ...rest } = v;
    return rest as MuxedVariant;
  }
  const { rankBitrate: _r, ...rest } = v;
  return rest as SplitVariant;
}

/** First label segment (e.g. 1440p60, 720p) — one menu row per distinct quality label. */
function qualityMenuRungKey(v: PlayableVariant): string {
  const head =
    v.label
      .split(/\s*·\s*/)[0]
      ?.trim()
      .toLowerCase() ?? "";
  return head || v.label.trim().toLowerCase();
}

/** One variant per rung (e.g. one 1440p60); `sorted` must prefer higher bitrate first within a rung. */
function dedupeOneVariantPerQualityRung(
  sorted: PlayableWithRank[],
): PlayableVariant[] {
  const seen = new Set<string>();
  const out: PlayableVariant[] = [];
  for (const v of sorted) {
    const k = qualityMenuRungKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(omitRankBitrate(v));
  }
  return out;
}

/**
 * Dedupes identical URLs; disambiguates duplicate labels (rare after per-rung dedupe).
 */
function buildFullQualitySelectorList(
  sorted: PlayableVariant[],
): PlayableVariant[] {
  if (sorted.length === 0) return [];
  const seen = new Set<string>();
  const out: PlayableVariant[] = [];
  const labelUses = new Map<string, number>();

  for (const v of sorted) {
    const key = v.t === "muxed" ? `m:${v.url}` : `s:${v.videoUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const baseLabel = v.label;
    const n = (labelUses.get(baseLabel) ?? 0) + 1;
    labelUses.set(baseLabel, n);
    const label = n === 1 ? baseLabel : `${baseLabel} (${n})`;

    out.push(v.t === "muxed" ? { ...v, label } : { ...v, label });
  }
  return out;
}

/**
 * Group audio variants by detected language, keeping the highest-bitrate URL
 * per language, so the player's "Language" picker lists each language once
 * (Invidious-style) instead of one row per audio bitrate.
 *
 * Variants whose language can't be detected get their own per-index bucket so
 * we don't accidentally collapse genuinely distinct unknown tracks together.
 */
function dedupeAudioOptionsByLanguage(
  audios: ReadonlyArray<VideoStreamSource>,
): {
  audioOptions: { url: string; label: string }[];
  defaultAudioUrl: string;
  defaultAudioIndex: number;
} {
  type Enriched = {
    src: VideoStreamSource;
    idx: number;
    key: string;
    label: string;
    bitrate: number;
    isOriginal: boolean;
  };

  const enriched: Enriched[] = audios.map((src, idx) => {
    const info = audioTrackLanguageInfo({
      displayName: src.audioTrackDisplayName,
      language: src.language,
      streamUrl: src.url,
    });
    const fallbackLabel = languageFirstAudioMenuLabel({
      displayName: src.audioTrackDisplayName,
      language: src.language,
      qualityFallback: labelForStream(src.quality, src.mimeType, idx),
      streamUrl: src.url,
      index: idx,
    });
    const isOriginal = streamLooksLikeOriginalAudio({
      displayName: src.audioTrackDisplayName,
      streamUrl: src.url,
    });
    let label = info.name ?? fallbackLabel;
    if (
      isOriginal &&
      !/\(\s*original\s*\)/i.test(label) &&
      !/\boriginal\b/i.test(label)
    ) {
      label = `${label} (Original)`;
    }
    return {
      src,
      idx,
      // One shared bucket for missing language metadata so multiple adaptive
      // bitrates of the same stream do not look like a multilingual picker.
      key: info.key ?? "__unknown",
      label,
      bitrate: typeof src.bitrate === "number" ? src.bitrate : 0,
      isOriginal,
    };
  });

  const bestByKey = new Map<string, Enriched>();
  for (const e of enriched) {
    const prev = bestByKey.get(e.key);
    if (!prev || e.bitrate > prev.bitrate) bestByKey.set(e.key, e);
  }

  const ordered = Array.from(bestByKey.values()).sort((a, b) => a.idx - b.idx);

  const audioOptions = ordered.flatMap((e) => {
    if (!e.src.url) return [];
    return [
      {
        url: e.src.url,
        label: e.label,
      },
    ];
  });

  const originals = ordered.filter((e) => e.isOriginal);
  let defaultPick: Enriched | undefined;
  if (originals.length > 0) {
    defaultPick = originals.reduce((a, b) => (b.bitrate > a.bitrate ? b : a));
  } else {
    const firstKey = enriched[0]?.key;
    defaultPick =
      (firstKey ? bestByKey.get(firstKey) : undefined) ?? ordered[0];
  }

  const defaultAudioUrl = defaultPick?.src.url ?? audios[0]?.url ?? "";
  const defaultAudioIndex = Math.max(
    0,
    audioOptions.findIndex((o) => o.url === defaultAudioUrl),
  );

  return { audioOptions, defaultAudioUrl, defaultAudioIndex };
}

/** One split row per video-only stream (same audio menu on each). */
function buildAllSplitVariants(
  detail: VideoDetail,
  keep: (s: VideoStreamSource) => boolean,
): SplitVariant[] {
  const videoCandidates = detail.videoSources
    .map((s, i) => ({ s, i }))
    .filter(
      ({ s }) =>
        keep(s) &&
        s.url &&
        isPipedHostedProgressiveUrl(detail, s.url) &&
        streamIsVideoOnly(s) &&
        !isDashPath(s.url) &&
        !isHlsPath(s.url),
    );
  const audios = (detail.audioSources ?? []).filter((a) => a.url);
  if (videoCandidates.length === 0 || audios.length === 0) return [];

  const { audioOptions, defaultAudioUrl, defaultAudioIndex } =
    dedupeAudioOptionsByLanguage(audios);
  if (!defaultAudioUrl) return [];

  videoCandidates.sort((a, b) => {
    const byQ =
      scoreQualityLabel(b.s.quality, b.i) - scoreQualityLabel(a.s.quality, a.i);
    if (byQ !== 0) return byQ;
    return scoreNativeVideoCodec(b.s) - scoreNativeVideoCodec(a.s);
  });

  return videoCandidates.flatMap(({ s, i }) => {
    if (!s.url) return [];
    return [
      {
        t: "split" as const,
        videoUrl: s.url,
        audioUrl: defaultAudioUrl,
        label: labelForStream(s.quality, s.mimeType, i),
        audioOptions,
        defaultAudioIndex,
        rankBitrate: s.bitrate,
      },
    ];
  });
}

/**
 * Vidstack 0.6 supports HLS (hls.js) and progressive video, but has no
 * DASH/MPD provider. We must not feed Invidious `dashUrl` to the player.
 * Split (video + audio) uses native <video> + <audio> sync for adaptive-only.
 */
export type WatchPlayback =
  | { kind: "hls"; url: string; onlyDashOrUnsupported: false }
  | {
      kind: "progressive";
      variants: PlayableVariant[];
      onlyDashOrUnsupported: false;
    }
  | { kind: "none"; onlyDashOrUnsupported: boolean };

function collectMuxed(
  detail: VideoDetail,
  keep: (s: VideoStreamSource) => boolean,
): MuxedVariant[] {
  const scored = detail.videoSources
    .map((s, i) => {
      const u = s.url;
      if (!u || isDashPath(u) || isHlsPath(u)) return null;
      if (!isPipedHostedProgressiveUrl(detail, u)) return null;
      if (s.videoOnly) return null;
      if (streamIsVideoOnly(s)) return null;
      if (!keep(s)) return null;
      const mt = s.mimeType?.toLowerCase() ?? "";
      if (mt.startsWith("audio/") && !mt.includes("video")) return null;
      if (mimeVideoTypeWithoutAudioCodecs(s.mimeType)) return null;
      return {
        s,
        i,
        score: scoreMuxed(s.quality, i),
        label: labelForStream(s.quality, s.mimeType, i),
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((r) => ({
    t: "muxed" as const,
    url: r.s.url,
    label: r.label,
    rankBitrate: r.s.bitrate,
  }));
}

function scorePlayable(v: PlayableVariant): number {
  return scoreQualityLabel(v.label, 0);
}

function parseRungHeight(label: string): number | null {
  const m = label.match(/(\d{2,4})\s*p/i);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Combined MP4 (often legacy itag 18) can be audio-only / black while split at
 * the same label height works. If any split exists for that rung, drop muxed.
 */
function dropMuxedWhenSplitMatchesResolution(
  muxed: MuxedVariant[],
  splits: SplitVariant[],
  detail?: VideoDetail,
): MuxedVariant[] {
  if (muxed.length === 0 || splits.length === 0) return muxed;
  if (detail?.sourceUsed === "piped" || detail?.sourceUsed === "cache") {
    return muxed;
  }
  const splitRungs = new Set<string>();
  for (const s of splits) splitRungs.add(qualityMenuRungKey(s));
  // Prefer split for low rungs where muxed often maps to legacy/broken assets.
  return muxed.filter((m) => {
    const rung = qualityMenuRungKey(m);
    if (!splitRungs.has(rung)) return true;
    const h = parseRungHeight(rung);
    if (h === null) return true;
    return h > 480;
  });
}

/** Start on the configured default rung (1080p by default). */
function preferPlaybackDefault(variants: PlayableVariant[]): PlayableVariant[] {
  return reorderVariantsForDefaultQuality(variants);
}

function sortPlayable(a: PlayableWithRank, b: PlayableWithRank): number {
  const sa = scorePlayable(a);
  const sb = scorePlayable(b);
  if (sb !== sa) return sb - sa;
  // Same resolution: prefer muxed first for audio reliability.
  if (a.t !== b.t) return a.t === "muxed" ? -1 : 1;
  const bra = rankBitrateOf(a);
  const brb = rankBitrateOf(b);
  if (brb !== bra) return brb - bra;
  return 0;
}

/**
 * Count distinct primary language subtags exposed by `detail.audioSources`.
 * Multi-language YouTube uploads (translated dubs) are typically only labelled
 * properly on Invidious's `adaptiveFormats[].audioTrack` data; the HLS manifest
 * we'd otherwise prefer often flattens or strips that metadata, so we use this
 * count to decide whether progressive split is worth preferring over HLS.
 */
function countDistinctAudioLanguages(detail: VideoDetail): number {
  const audios = detail.audioSources ?? [];
  if (audios.length < 2) return audios.length;
  const keys = new Set<string>();
  for (const src of audios) {
    if (!src.url) continue;
    const info = audioTrackLanguageInfo({
      displayName: src.audioTrackDisplayName,
      language: src.language,
      streamUrl: src.url,
    });
    if (info.key) keys.add(info.key);
  }
  return keys.size;
}

function hasUsableProgressiveVideoPane(detail: VideoDetail): boolean {
  return detail.videoSources.some((s) => {
    const u = s.url;
    if (!u) return false;
    if (isDashPath(u) || isHlsPath(u)) return false;
    return sourceLooksLikeVideoPane(s);
  });
}

/**
 * True when there are adaptive **video-only** streams — i.e. playback would
 * otherwise take the progressive *split* path (video-only element + separate
 * audio), whose Safari seeking to un-buffered positions stalls (single huge
 * progressive file). We instead route these to the synthesized VOD HLS manifest
 * (`generate.ts`), which is segmented and seeks reliably. Triggering on this
 * rather than `detail.dashUrl` is deliberate: the fetch/cache layer sometimes
 * drops `dashUrl` (and codec strings) even when the adaptive streams exist.
 * `generate.ts` re-fetches its own fresh AVC streams, so we don't require the
 * codec here (near-universally H.264 is available for YouTube VOD).
 */
function hasAdaptiveVideoOnly(detail: VideoDetail): boolean {
  return detail.videoSources.some((s) => {
    const u = s.url;
    if (!u || isDashPath(u) || isHlsPath(u)) return false;
    return streamIsVideoOnly(s);
  });
}

function firstHlsUrlFromDetail(detail: VideoDetail): string | undefined {
  if (detail.hlsUrl) return detail.hlsUrl;
  for (const s of detail.videoSources) {
    const u = s.url;
    if (u && isHlsPath(u)) return u;
  }
  return undefined;
}

export function buildWatchPlayback(
  detail: VideoDetail,
  options?: {
    shorts?: boolean;
    /**
     * iOS Safari: a second unmuted media element is blocked by the autoplay
     * policy, so split video+audio stalls or plays silent. Prefer HLS (native
     * on iOS), then muxed progressive; split stays as a last resort.
     */
    avoidSplitAudioVideo?: boolean;
  },
): WatchPlayback {
  if (detail.isLive) {
    const hls = firstHlsUrlFromDetail(detail);
    if (hls) {
      return { kind: "hls", url: hls, onlyDashOrUnsupported: false };
    }
    if (detail.dashUrl) {
      return { kind: "none", onlyDashOrUnsupported: true };
    }
    return { kind: "none", onlyDashOrUnsupported: false };
  }

  const isPipedLike = detail.sourceUsed === "piped";

  const buildMerged = (keep: (s: VideoStreamSource) => boolean) => {
    let muxed = collectMuxed(detail, keep);
    const splits = buildAllSplitVariants(detail, keep);
    muxed = dropMuxedWhenSplitMatchesResolution(muxed, splits, detail);
    const ranked: PlayableWithRank[] = [...muxed, ...splits];
    ranked.sort(sortPlayable);
    return dedupeOneVariantPerQualityRung(ranked);
  };

  if (options?.shorts) {
    if (options.avoidSplitAudioVideo) {
      const hls = firstHlsUrlFromDetail(detail);
      if (hls) {
        return { kind: "hls", url: hls, onlyDashOrUnsupported: false };
      }
    }
    let merged = buildMerged(sourceLooksLikeVideoPane);
    if (merged.length === 0) {
      merged = buildMerged(() => true);
    }
    if (merged.length > 0) {
      let variants = preferPlaybackDefault(
        buildFullQualitySelectorList(merged),
      );
      if (options.avoidSplitAudioVideo) {
        variants = [
          ...variants.filter((v) => v.t === "muxed"),
          ...variants.filter((v) => v.t === "split"),
        ];
      }
      return {
        kind: "progressive",
        variants,
        onlyDashOrUnsupported: false,
      };
    }
    if (detail.hlsUrl) {
      return { kind: "hls", url: detail.hlsUrl, onlyDashOrUnsupported: false };
    }
    for (const s of detail.videoSources) {
      const u = s.url;
      if (u && isHlsPath(u)) {
        return { kind: "hls", url: u, onlyDashOrUnsupported: false };
      }
    }
    if (detail.dashUrl) {
      return { kind: "none", onlyDashOrUnsupported: true };
    }
    return { kind: "none", onlyDashOrUnsupported: false };
  }

  // Prefer progressive (split) over HLS when Invidious exposes ≥2 audio
  // languages: HLS manifests routinely lose `LANGUAGE="..."` on EXT-X-MEDIA
  // entries, which strands the in-player language picker. Only do this when
  // we actually have a video-only progressive pane to pair with the audio
  // tracks, otherwise the player has nothing useful to render.
  const preferSplitForLanguages =
    !options?.shorts &&
    countDistinctAudioLanguages(detail) >= 2 &&
    hasUsableProgressiveVideoPane(detail);

  // Drop sources that are clearly audio-only / no video plane; if that
  // removes everything, fall back to the unfiltered list (rare bad metadata).
  let merged = buildMerged(sourceLooksLikeVideoPane);
  if (merged.length === 0) {
    merged = buildMerged(() => true);
  }

  // Single-language Piped: prefer HLS (one muxed stream) over progressive. The
  // progressive list's HD rungs are video-only "split" variants paired with a
  // separate <audio> element, which drift out of sync over time. HLS avoids the
  // split path entirely. We only fall back to progressive when there are ≥2
  // audio languages (HLS drops the language picker) or no HLS URL exists.
  if (isPipedLike && merged.length > 0) {
    if (detail.hlsUrl && !preferSplitForLanguages) {
      return { kind: "hls", url: detail.hlsUrl, onlyDashOrUnsupported: false };
    }
    const variants = preferPlaybackDefault(
      buildFullQualitySelectorList(merged),
    );
    return {
      kind: "progressive",
      variants,
      onlyDashOrUnsupported: false,
    };
  }

  // Synthesize a byte-range HLS manifest from the adaptive fMP4 streams and
  // play it as HLS — native on iOS (the only robust path there; MSE engines
  // like dash.js stall/freeze) and hls.js everywhere else. Replaces both the
  // split video+audio path and Invidious's native `hlsUrl`. Any adaptive
  // video-only stream (or `dashUrl`) signals the adaptive streams exist; only
  // Piped is excluded (no Invidious adaptive streams).
  //
  // Also used for MULTI-LANGUAGE videos: the alternative (progressive *split*)
  // offers an in-player language picker, but its single-huge-progressive-file
  // seek stalls in Safari and its second <audio> element is blocked on iOS. We
  // prioritise reliable seeking and play the synthesized HLS with the DEFAULT
  // (original) audio track; a multi-language HLS audio group is the follow-up.
  //
  // Preferred OVER Invidious's native `hlsUrl` below: the synthesized manifest's
  // segments resolve to the same-origin, companion-backed `/invidious/videoplayback`
  // proxy, whereas native `hlsUrl` segments are raw googlevideo URLs that 403 when
  // fetched from the server IP. Native `hlsUrl` stays as the fallback for videos
  // with no adaptive streams.
  if ((detail.dashUrl || hasAdaptiveVideoOnly(detail)) && !isPipedLike) {
    return {
      kind: "hls",
      url: `/hls/${detail.videoId}/master.m3u8`,
      onlyDashOrUnsupported: false,
    };
  }

  if (detail.hlsUrl && !preferSplitForLanguages) {
    return { kind: "hls", url: detail.hlsUrl, onlyDashOrUnsupported: false };
  }

  if (merged.length > 0) {
    const variants = preferPlaybackDefault(
      buildFullQualitySelectorList(merged),
    );
    return {
      kind: "progressive",
      variants,
      onlyDashOrUnsupported: false,
    };
  }

  // No usable progressive variants but HLS available — fall back to HLS so
  // playback still works even though the language picker may not render.
  if (detail.hlsUrl) {
    return { kind: "hls", url: detail.hlsUrl, onlyDashOrUnsupported: false };
  }

  for (const s of detail.videoSources) {
    const u = s.url;
    if (u && isHlsPath(u)) {
      return { kind: "hls", url: u, onlyDashOrUnsupported: false };
    }
  }

  if (detail.dashUrl) {
    return { kind: "none", onlyDashOrUnsupported: true };
  }

  return { kind: "none", onlyDashOrUnsupported: false };
}

/** @deprecated for tests — same as "first src" of buildWatchPlayback */
export function pickPlaybackForVidstack(detail: VideoDetail): {
  src: string;
  onlyDashOrUnsupported: boolean;
} {
  const w = buildWatchPlayback(detail);
  if (w.kind === "hls") return { src: w.url, onlyDashOrUnsupported: false };
  if (w.kind === "progressive" && w.variants[0]) {
    const v0 = w.variants[0];
    if (v0.t === "muxed") return { src: v0.url, onlyDashOrUnsupported: false };
    return { src: v0.videoUrl, onlyDashOrUnsupported: false };
  }
  if (w.kind === "none" && w.onlyDashOrUnsupported) {
    return { src: "", onlyDashOrUnsupported: true };
  }
  return { src: "", onlyDashOrUnsupported: false };
}
