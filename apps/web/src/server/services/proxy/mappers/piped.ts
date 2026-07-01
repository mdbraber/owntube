import { pickChannelSubscriberCount } from "@/lib/channel-subscriber-count";
import { titleSuggestsMembersOnlyOrSubscriberOnly } from "@/lib/feed-exclude-restricted";
import {
  normalizeDurationForLive,
  pickLiveFlagsFromUpstream,
} from "@/lib/live-video";
import { normalizePipedDescription } from "@/lib/normalize-video-description";
import { coercePublishedSecondsFromUpstream } from "@/lib/published-sort-key";
import { pipedItemIsStrictShort } from "@/lib/short-video";
import { preferHighResVideoThumbnailUrl } from "@/lib/video-thumbnail-url";
import {
  channelIdFromPath,
  extractVideoIdFromUrl,
  isUpstreamMembersOrPaidOnly,
  mimeVideoTypeWithoutAudioCodecs,
  pickVideoThumbnail,
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

export function pipedRootItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.results)) return o.results;
  }
  return [];
}

export function pipedNextPage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const n = o.nextpage;
  if (typeof n === "string" && n.length > 0) return n;
  return null;
}

export function pipedListItemsFromPayload(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.relatedStreams) && o.relatedStreams.length > 0) {
    return o.relatedStreams;
  }
  if (Array.isArray(o.content) && o.content.length > 0) {
    return o.content;
  }
  return [];
}

/** Piped list items (search, trending, related) often include uploader avatar on each item. */
function pickPipedUploaderAvatar(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const stringKeys = [
    "uploaderAvatar",
    "uploader_avatar",
    "channelAvatarUrl",
  ] as const;
  for (const key of stringKeys) {
    const raw = o[key];
    if (typeof raw !== "string") continue;
    const u = resolveInvidiousAbsoluteMediaUrl(raw, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  for (const key of ["uploaderAvatars", "avatars"] as const) {
    const u = resolveInvidiousThumbnail(o[key], pipedBase);
    if (u?.startsWith("http")) return u;
  }
  return undefined;
}

export function mapPipedItem(
  raw: unknown,
  pipedBase = "",
): UnifiedVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = typeof o.type === "string" ? o.type.toLowerCase() : "";
  if (t && t !== "stream" && t !== "video" && t !== "livestream") return null;
  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const url = typeof o.url === "string" ? o.url : "";
  const title = typeof o.title === "string" ? o.title : "";
  const videoId = extractVideoIdFromUrl(url);
  if (!videoId || !title) return null;
  if (isUpstreamMembersOrPaidOnly(o)) return null;
  if (titleSuggestsMembersOnlyOrSubscriberOnly(title)) return null;
  const thumbnail =
    typeof o.thumbnail === "string"
      ? o.thumbnail
      : pickVideoThumbnail(o.thumbnails, videoId, {
          preferPortrait: pipedItemIsStrictShort(o),
        });
  const rawDuration =
    typeof o.duration === "number" &&
    Number.isFinite(o.duration) &&
    o.duration > 0
      ? o.duration
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDuration, isLive);
  const viewCount = pickViewCount(o);
  const publishedText =
    typeof o.uploadedDate === "string" ? o.uploadedDate : undefined;
  const publishedAt =
    coercePublishedSecondsFromUpstream(o.uploaded) ??
    coercePublishedSecondsFromUpstream(o.time) ??
    coercePublishedSecondsFromUpstream(o.timestamp) ??
    coercePublishedSecondsFromUpstream(o.published);
  const reconciledPublishedAt = reconcilePublishedAtWithText(
    publishedAt,
    publishedText,
  );
  const channelName =
    typeof o.uploaderName === "string"
      ? o.uploaderName
      : typeof o.uploader === "string"
        ? o.uploader
        : undefined;
  const uploaderUrl =
    typeof o.uploaderUrl === "string" ? o.uploaderUrl : undefined;
  const channelId = channelIdFromPath(uploaderUrl);
  const channelAvatarUrl = pickPipedUploaderAvatar(o, pipedBase);
  const parsed = unifiedVideoSchema.safeParse({
    videoId,
    title,
    channelId,
    channelName,
    channelAvatarUrl,
    thumbnailUrl: preferHighResVideoThumbnailUrl(thumbnail, videoId),
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

function pickPipedChannelAvatar(
  o: Record<string, unknown>,
  pipedBase: string,
): string | undefined {
  const fromUploader = pickPipedUploaderAvatar(o, pipedBase);
  if (fromUploader) return fromUploader;
  const thumb = o.thumbnail;
  if (typeof thumb === "string") {
    const u = resolveInvidiousAbsoluteMediaUrl(thumb, pipedBase);
    if (u?.startsWith("http")) return u;
  }
  return undefined;
}

export function mapPipedChannelItem(
  raw: unknown,
  pipedBase = "",
): UnifiedChannel | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = typeof o.type === "string" ? o.type.toLowerCase() : "";
  if (t !== "channel") return null;
  const channelId =
    channelIdFromPath(typeof o.url === "string" ? o.url : undefined) ??
    channelIdFromPath(
      typeof o.uploaderUrl === "string" ? o.uploaderUrl : undefined,
    ) ??
    (typeof o.id === "string" ? o.id : undefined);
  const name =
    typeof o.name === "string"
      ? o.name
      : typeof o.title === "string"
        ? o.title
        : typeof o.uploaderName === "string"
          ? o.uploaderName
          : typeof o.uploader === "string"
            ? o.uploader
            : "";
  if (!channelId || !name) return null;
  return {
    channelId,
    name,
    avatarUrl: pickPipedChannelAvatar(o, pipedBase),
    subscriberCount: pickChannelSubscriberCount(o),
    description: typeof o.description === "string" ? o.description : undefined,
  };
}

/** Piped exposes `codec` separately; merge into mime for playback heuristics. */
function pipedStreamMimeType(
  stream: Record<string, unknown>,
): string | undefined {
  const base =
    typeof stream.mimeType === "string" ? stream.mimeType.trim() : "";
  const codec = typeof stream.codec === "string" ? stream.codec.trim() : "";
  if (!base) return codec ? `video/mp4; codecs="${codec}"` : undefined;
  if (!codec || base.includes("codecs=")) return base;
  return `${base}; codecs="${codec}"`;
}

export function mapPipedStream(
  data: unknown,
  pipedBase: string,
  knownVideoId?: string,
): VideoDetail | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const fromPayload =
    typeof o.videoId === "string" && o.videoId.length > 0
      ? o.videoId
      : extractVideoIdFromUrl(String(o.url ?? ""));
  const videoId = fromPayload || knownVideoId?.trim() || "";
  const title = typeof o.title === "string" ? o.title : "";
  if (!videoId || !title) return null;
  const uploaderUrl =
    typeof o.uploaderUrl === "string" ? o.uploaderUrl : undefined;

  const audioStreams = Array.isArray(o.audioStreams) ? o.audioStreams : [];
  const videoStreams = Array.isArray(o.videoStreams) ? o.videoStreams : [];
  const audioSources = audioStreams
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const stream = item as Record<string, unknown>;
      const url = typeof stream.url === "string" ? stream.url : "";
      if (!url.startsWith("http")) return null;
      const bitrate = readPositiveNumberField(stream, [
        "bitrate",
        "averageBitrate",
      ]);
      const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
      return {
        url,
        mimeType: pipedStreamMimeType(stream),
        quality:
          typeof stream.quality === "string" ? stream.quality : undefined,
        bitrate,
        fps,
        language:
          typeof stream.language === "string"
            ? stream.language
            : typeof stream.lang === "string"
              ? stream.lang
              : typeof stream.audioLanguage === "string"
                ? stream.audioLanguage
                : undefined,
        audioTrackDisplayName:
          typeof stream.audioTrackName === "string"
            ? stream.audioTrackName
            : typeof stream.audioTrackDisplayName === "string"
              ? stream.audioTrackDisplayName
              : undefined,
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const videoSources = videoStreams
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const stream = item as Record<string, unknown>;
      const url = typeof stream.url === "string" ? stream.url : "";
      if (!url.startsWith("http")) return null;
      const bitrate = readPositiveNumberField(stream, [
        "bitrate",
        "averageBitrate",
      ]);
      const fps = readPositiveNumberField(stream, ["fps", "frameRate"]);
      const height = readStreamHeightPx(stream);
      return {
        url,
        mimeType: pipedStreamMimeType(stream),
        quality:
          typeof stream.quality === "string" ? stream.quality : undefined,
        bitrate,
        fps,
        height,
        videoOnly:
          stream.videoOnly === true ||
          mimeVideoTypeWithoutAudioCodecs(pipedStreamMimeType(stream)),
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const publishedAt =
    coercePublishedSecondsFromUpstream(o.uploadDate) ??
    coercePublishedSecondsFromUpstream(o.uploaded);
  const publishedText =
    publishedAt !== undefined
      ? undefined
      : typeof o.uploadDate === "string"
        ? o.uploadDate
        : toUnixText(o.uploaded);

  const { isLive, isUpcoming } = pickLiveFlagsFromUpstream(o);
  const rawDurationSeconds =
    typeof o.duration === "number" && Number.isFinite(o.duration)
      ? Math.floor(o.duration)
      : undefined;
  const durationSeconds = normalizeDurationForLive(rawDurationSeconds, isLive);

  const detail = {
    videoId,
    title,
    description:
      typeof o.description === "string"
        ? normalizePipedDescription(o.description)
        : undefined,
    channelId:
      typeof o.uploaderId === "string" && o.uploaderId.length > 0
        ? o.uploaderId
        : channelIdFromPath(uploaderUrl),
    channelName: typeof o.uploader === "string" ? o.uploader : undefined,
    channelAvatarUrl: pickPipedUploaderAvatar(o, pipedBase),
    channelSubscriberCount: pickChannelSubscriberCount(o),
    relatedVideos: (() => {
      const out: UnifiedVideo[] = [];
      for (const item of pipedListItemsFromPayload(o)) {
        const mapped = mapPipedItem(item, pipedBase);
        if (!mapped || mapped.videoId === videoId) continue;
        out.push(mapped);
        if (out.length >= 24) break;
      }
      return out.length > 0 ? out : undefined;
    })(),
    thumbnailUrl: preferHighResVideoThumbnailUrl(
      typeof o.thumbnailUrl === "string"
        ? o.thumbnailUrl
        : pickVideoThumbnail(o.thumbnails, videoId),
      videoId,
    ),
    durationSeconds,
    viewCount: pickViewCount(o),
    publishedText,
    publishedAt,
    isLive: isLive || undefined,
    isUpcoming: isUpcoming || undefined,
    hlsUrl:
      typeof o.hls === "string" && o.hls.trim().length > 0 ? o.hls : undefined,
    dashUrl:
      typeof o.dash === "string" && o.dash.trim().length > 0
        ? o.dash
        : undefined,
    audioSources,
    videoSources,
    sourceUsed: "piped" as const,
    mediaProxyBase:
      typeof o.proxyUrl === "string"
        ? o.proxyUrl.trim().replace(/\/+$/, "")
        : undefined,
  };
  const parsed = videoDetailSchema.safeParse(detail);
  if (!parsed.success) return null;
  return parsed.data;
}
