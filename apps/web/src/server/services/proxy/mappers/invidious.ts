import { pickChannelSubscriberCount } from "@/lib/channel-subscriber-count";
import { titleSuggestsMembersOnlyOrSubscriberOnly } from "@/lib/feed-exclude-restricted";
import {
  normalizeDurationForLive,
  pickLiveFlagsFromUpstream,
} from "@/lib/live-video";
import { coercePublishedSecondsFromUpstream } from "@/lib/published-sort-key";
import { preferHighResVideoThumbnailUrl } from "@/lib/video-thumbnail-url";
import {
  isUpstreamMembersOrPaidOnly,
  pickInvidiousStoryboard,
  pickViewCount,
  readPositiveNumberField,
  readStreamHeightPx,
  reconcilePublishedAtWithText,
  resolveInvidiousAbsoluteMediaUrl,
  resolveInvidiousThumbnail,
  toUnixText,
} from "@/server/services/proxy/normalize";
import {
  type UnifiedChannel,
  type UnifiedVideo,
  unifiedVideoSchema,
  type VideoDetail,
  videoDetailSchema,
} from "@/server/services/proxy.types";

export function mapInvidiousItem(
  raw: unknown,
  baseUrl = "",
): UnifiedVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const itemType = typeof o.type === "string" ? o.type : "";
  if (
    itemType !== "video" &&
    itemType !== "shortVideo" &&
    itemType !== "livestream"
  ) {
    return null;
  }
  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const videoId = typeof o.videoId === "string" ? o.videoId : "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  if (isUpstreamMembersOrPaidOnly(o)) return null;
  if (titleSuggestsMembersOnlyOrSubscriberOnly(title)) return null;
  const isShortItem = itemType === "shortVideo";
  const thumbnailUrl = preferHighResVideoThumbnailUrl(
    resolveInvidiousThumbnail(o.videoThumbnails, baseUrl, {
      preferPortrait: isShortItem,
    }),
    videoId,
  );
  const rawDuration =
    typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
      ? o.lengthSeconds
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDuration, isLive);
  const viewCount = pickViewCount(o);
  const publishedText =
    typeof o.publishedText === "string" ? o.publishedText : undefined;
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.published) ??
    coercePublishedSecondsFromUpstream(o.publishedAt) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.premiereTimestamp);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );
  const channelName = typeof o.author === "string" ? o.author : undefined;
  const channelId = typeof o.authorId === "string" ? o.authorId : undefined;
  const channelAvatarUrl = resolveInvidiousThumbnail(
    o.authorThumbnails,
    baseUrl,
  );
  const parsed = unifiedVideoSchema.safeParse({
    videoId,
    title,
    channelId,
    channelName,
    channelAvatarUrl,
    thumbnailUrl,
    durationSeconds,
    viewCount,
    publishedText,
    publishedAt: reconciledPublishedAt,
    isLive: isLive || undefined,
    isUpcoming: isUpcoming || undefined,
  });
  if (!parsed.success) return null;
  return parsed.data;
}

export function mapInvidiousChannelItem(
  raw: unknown,
  baseUrl = "",
): UnifiedChannel | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "channel") return null;
  const channelId =
    typeof o.authorId === "string"
      ? o.authorId
      : typeof o.channelId === "string"
        ? o.channelId
        : "";
  const name =
    typeof o.author === "string"
      ? o.author
      : typeof o.name === "string"
        ? o.name
        : "";
  if (!channelId || !name) return null;
  const avatarUrl =
    resolveInvidiousThumbnail(o.authorThumbnails, baseUrl) ??
    resolveInvidiousThumbnail(o.channelThumbnails, baseUrl);
  return {
    channelId,
    name,
    avatarUrl,
    subscriberCount: pickChannelSubscriberCount(o),
    description: typeof o.description === "string" ? o.description : undefined,
  };
}

function invidiousAdaptiveMimeIsAudio(mime: string | undefined): boolean {
  if (!mime) return false;
  return mime.toLowerCase().trim().startsWith("audio/");
}

function readInvidiousAdaptiveAudioMeta(st: Record<string, unknown>): {
  language?: string;
  displayName?: string;
} {
  const at = st.audioTrack;
  if (at && typeof at === "object") {
    const t = at as Record<string, unknown>;
    const displayName =
      typeof t.displayName === "string" ? t.displayName : undefined;
    let language: string | undefined;
    if (typeof t.id === "string" && t.id.length > 0) {
      language = t.id.replace(/^\./, "").split(".")[0];
    } else if (typeof t.languageCode === "string") {
      language = t.languageCode;
    } else if (typeof t.language === "string") {
      language = t.language;
    }
    return { displayName, language };
  }
  if (typeof st.audioTrackId === "string" && st.audioTrackId.length > 0) {
    return {
      language: st.audioTrackId.replace(/^\./, "").split(/[.]/)[0],
    };
  }

  const lang =
    typeof st.language === "string"
      ? st.language
      : typeof st.lang === "string"
        ? st.lang
        : typeof st.audioLanguage === "string"
          ? st.audioLanguage
          : undefined;
  const displayName =
    typeof st.audioTrackDisplayName === "string"
      ? st.audioTrackDisplayName
      : typeof st.name === "string"
        ? st.name
        : undefined;
  if (lang || displayName) return { language: lang, displayName };

  const ql = typeof st.qualityLabel === "string" ? st.qualityLabel.trim() : "";
  if (
    ql &&
    !/^(tiny|low|light|medium|high|small|144p|240p|360p|480p|720p|1080p)/i.test(
      ql,
    )
  ) {
    return { displayName: ql };
  }

  return {};
}

type InvidiousStream = {
  url: string;
  mimeType: string | undefined;
  quality: string | undefined;
  videoOnly: boolean;
  bitrate?: number;
  fps?: number;
  height?: number;
};

function mapInvidiousStreamItem(
  item: unknown,
  baseUrl: string,
  videoOnly: boolean,
): InvidiousStream | null {
  if (!item || typeof item !== "object") return null;
  const stream = item as Record<string, unknown>;
  const rawUrl = typeof stream.url === "string" ? stream.url : "";
  const url = resolveInvidiousAbsoluteMediaUrl(rawUrl, baseUrl);
  if (!url) return null;
  const type = typeof stream.type === "string" ? stream.type : undefined;
  const quality =
    typeof stream.qualityLabel === "string"
      ? stream.qualityLabel
      : typeof stream.quality === "string"
        ? stream.quality
        : undefined;
  const bitrate = readPositiveNumberField(stream, [
    "bitrate",
    "averageBitrate",
  ]);
  const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
  const height = readStreamHeightPx(stream);
  return { url, mimeType: type, quality, videoOnly, bitrate, fps, height };
}

/**
 * Map Invidious `captions[]` (`{label, language_code, url}`) to our
 * `{label, languageCode}` shape. The upstream `url` is dropped: the client
 * rebuilds a same-origin `/captions/{videoId}?label=…` URL so caption fetches
 * go through our validating, caching proxy instead of straight to Invidious.
 */
function mapInvidiousCaptions(
  value: unknown,
): { label: string; languageCode: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { label: string; languageCode: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const label = typeof c.label === "string" ? c.label : "";
    if (!label) continue;
    const languageCode =
      typeof c.language_code === "string"
        ? c.language_code
        : typeof c.languageCode === "string"
          ? c.languageCode
          : "";
    out.push({ label, languageCode });
  }
  return out.length > 0 ? out : undefined;
}

export function mapInvidiousVideo(
  data: unknown,
  baseUrl = "",
): VideoDetail | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const videoId = typeof o.videoId === "string" ? o.videoId : "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  const formatStreams = Array.isArray(o.formatStreams) ? o.formatStreams : [];
  const adaptiveFormats = Array.isArray(o.adaptiveFormats)
    ? o.adaptiveFormats
    : [];
  const fromFormat = formatStreams
    .map((item) => mapInvidiousStreamItem(item, baseUrl, false))
    .filter((value): value is InvidiousStream => Boolean(value));

  const fromAdaptiveVideo: InvidiousStream[] = [];
  const audioFromAdaptive: {
    url: string;
    mimeType: string | undefined;
    quality: string | undefined;
    bitrate?: number;
    fps?: number;
    language?: string;
    audioTrackDisplayName?: string;
  }[] = [];
  for (const item of adaptiveFormats) {
    if (!item || typeof item !== "object") continue;
    const st = item as Record<string, unknown>;
    const mime = typeof st.type === "string" ? st.type : undefined;
    if (invidiousAdaptiveMimeIsAudio(mime)) {
      const m = mapInvidiousStreamItem(item, baseUrl, false);
      if (m) {
        const meta = readInvidiousAdaptiveAudioMeta(st);
        audioFromAdaptive.push({
          url: m.url,
          mimeType: m.mimeType,
          quality: m.quality,
          bitrate: m.bitrate,
          fps: m.fps,
          language: meta.language,
          audioTrackDisplayName: meta.displayName,
        });
      }
    } else {
      const m = mapInvidiousStreamItem(item, baseUrl, true);
      if (m) fromAdaptiveVideo.push(m);
    }
  }

  const videoSources: InvidiousStream[] = [...fromFormat, ...fromAdaptiveVideo];

  const hlsResolved = resolveInvidiousAbsoluteMediaUrl(
    typeof o.hlsUrl === "string" ? o.hlsUrl : undefined,
    baseUrl,
  );
  const dashResolved = resolveInvidiousAbsoluteMediaUrl(
    typeof o.dashUrl === "string" ? o.dashUrl : undefined,
    baseUrl,
  );

  const publishedText =
    typeof o.publishedText === "string"
      ? o.publishedText
      : toUnixText(o.published);
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.published) ??
    coercePublishedSecondsFromUpstream(o.publishedAt) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.premiereTimestamp);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );

  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const rawDurationSeconds =
    typeof o.lengthSeconds === "number" && Number.isFinite(o.lengthSeconds)
      ? Math.floor(o.lengthSeconds)
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDurationSeconds, isLive);

  const detail = {
    videoId,
    title,
    description: typeof o.description === "string" ? o.description : undefined,
    channelId: typeof o.authorId === "string" ? o.authorId : undefined,
    channelName: typeof o.author === "string" ? o.author : undefined,
    channelAvatarUrl: resolveInvidiousThumbnail(o.authorThumbnails, baseUrl),
    channelSubscriberCount: pickChannelSubscriberCount(o),
    storyboard: pickInvidiousStoryboard(o, baseUrl),
    thumbnailUrl: resolveInvidiousThumbnail(o.videoThumbnails, baseUrl),
    durationSeconds,
    viewCount: pickViewCount(o),
    publishedText,
    publishedAt: reconciledPublishedAt,
    isLive: isLive || undefined,
    isUpcoming: isUpcoming || undefined,
    hlsUrl: hlsResolved,
    dashUrl: dashResolved,
    audioSources: audioFromAdaptive,
    videoSources,
    captions: mapInvidiousCaptions(o.captions),
    sourceUsed: "invidious" as const,
  };
  const parsed = videoDetailSchema.safeParse(detail);
  if (!parsed.success) return null;
  return parsed.data;
}
