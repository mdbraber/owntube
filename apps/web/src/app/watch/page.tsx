import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChannelSubscribeButton } from "@/components/channel/channel-subscribe-button";
import { InteractionButtons } from "@/components/player/interaction-buttons";
import { WatchChannelTags } from "@/components/player/watch-channel-tags";
import { WatchTracker } from "@/components/player/watch-tracker";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { VideoCardCompact } from "@/components/videos/video-card";
import { WatchAgeRestricted } from "@/components/watch/watch-age-restricted";
import { WatchChaptersSection } from "@/components/watch/watch-chapters-section";
import { WatchCinemaProvider } from "@/components/watch/watch-cinema-context";
import { WatchCommentsSection } from "@/components/watch/watch-comments-section";
import { WatchDescription } from "@/components/watch/watch-description";
import { WatchPageGrid } from "@/components/watch/watch-page-grid";
import { WatchPlayerMount } from "@/components/watch/watch-player-mount";
import { WatchUpcomingLive } from "@/components/watch/watch-upcoming-live";
import { stripRestrictedListVideos } from "@/lib/feed-exclude-restricted";
import { watchHref } from "@/lib/yt-routes";
import {
  getAppOriginFromRequestHeaders,
  toProxiedOrDirectPlayback,
  toProxiedOrDirectPoster,
  toProxiedOrDirectVariants,
} from "@/lib/invidious-proxy";
import { buildWatchPlayback } from "@/lib/pick-playback";
import { scrubPreviewStreamFromDetail } from "@/lib/scrub-preview-stream";
import { sponsorBlockPrefsFromAppSettings } from "@/lib/sponsorblock-prefs";
import { shouldPreferInvidiousOverPiped } from "@/lib/upstream-playback-catalog";
import { parseChaptersFromDescription } from "@/lib/video-chapters";
import {
  formatPublishedLabel,
  formatSubscribersLabel,
  formatViews,
} from "@/lib/video-display";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { UpstreamAgeRestrictedError } from "@/server/errors/upstream-age-restricted";
import { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";
import {
  getWatchResumeSeconds,
  isVideoWatched,
} from "@/server/history/watch-resume";
import { getRecommendations } from "@/server/recommendation/engine";
import { fetchAdaptiveFormats } from "@/server/services/hls/generate";
import {
  fetchRelatedVideos,
  fetchTrendingVideos,
  fetchVideoDetail,
} from "@/server/services/proxy";
import type { UnifiedVideo, VideoDetail } from "@/server/services/proxy.types";
import {
  upstreamPlaybackSourceSchema,
  videoDetailInputSchema,
} from "@/server/services/proxy.types";
import {
  getUserProxyOverrides,
  getUserSettings,
  normalizeTrendingRegionStored,
} from "@/server/settings/profile";

type WatchPageProps = {
  searchParams: Promise<{
    v?: string | string[];
    t?: string | string[];
    upstream?: string | string[];
  }>;
};

/** YouTube-canonical: the video id lives in `?v=`. */
function readVideoId(v: string | string[] | undefined): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v[0]?.trim() ?? "";
  return "";
}

export async function generateMetadata({
  searchParams,
}: WatchPageProps): Promise<Metadata> {
  const videoId = readVideoId((await searchParams).v);
  if (!videoId) return { title: "Video" };
  const input = videoDetailInputSchema.parse({ videoId });
  const db = getDb();
  try {
    const detail = await fetchVideoDetail(db, input);
    return { title: detail.title };
  } catch (error) {
    if (error instanceof UpstreamLiveUpcomingError) {
      return { title: "Upcoming live stream" };
    }
    if (error instanceof UpstreamAgeRestrictedError) {
      return { title: "Age-restricted video" };
    }
    return { title: "Video" };
  }
}

export default async function WatchPage({ searchParams }: WatchPageProps) {
  noStore();
  const sp = await searchParams;
  const videoId = readVideoId(sp.v);
  if (!videoId) notFound();
  const rawT = typeof sp.t === "string" ? sp.t.trim() : "";
  const startAtSeconds = /^\d+$/.test(rawT)
    ? Number.parseInt(rawT, 10)
    : undefined;
  const rawUpstream =
    typeof sp.upstream === "string"
      ? sp.upstream.trim()
      : Array.isArray(sp.upstream)
        ? sp.upstream[0]?.trim()
        : "";
  const preferUpstreamParsed =
    rawUpstream.length > 0
      ? upstreamPlaybackSourceSchema.safeParse(rawUpstream)
      : null;
  const preferUpstream = preferUpstreamParsed?.success
    ? preferUpstreamParsed.data
    : undefined;
  const input = videoDetailInputSchema.parse({
    videoId,
    ...(preferUpstream ? { preferUpstream } : {}),
  });
  const db = getDb();
  const session = await auth();
  const userId = session?.user?.id ? Number.parseInt(session.user.id, 10) : NaN;
  const overrides = getUserProxyOverrides(
    db,
    Number.isFinite(userId) ? userId : null,
  );
  const h = await headers();
  const requestHost =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ?? h.get("host") ?? "";
  const appOrigin = getAppOriginFromRequestHeaders(h);
  const isAuthed = Boolean(session?.user?.id);
  const userSettings =
    Number.isFinite(userId) && userId > 0 ? getUserSettings(db, userId) : null;
  const feedRegion =
    Number.isFinite(userId) && userId > 0
      ? normalizeTrendingRegionStored(
          getUserSettings(db, userId).trendingRegion,
        )
      : "US";
  let detail: VideoDetail | null = null;
  let upcomingLive: UpstreamLiveUpcomingError | null = null;
  let ageRestricted: UpstreamAgeRestrictedError | null = null;
  try {
    detail = await fetchVideoDetail(db, input, overrides, {
      bypassDetailCache: true,
      preferUpstream,
    });
  } catch (error) {
    if (error instanceof UpstreamLiveUpcomingError) {
      upcomingLive = error;
    } else if (error instanceof UpstreamAgeRestrictedError) {
      ageRestricted = error;
    } else {
      throw error;
    }
  }

  const isUpcoming = upcomingLive !== null || detail?.isUpcoming === true;
  const isLive = !isUpcoming && detail?.isLive === true;

  // Resume a previously-watched, unfinished video where the viewer left off,
  // unless the URL asked for a specific time (?t=) or this is a live/upcoming
  // stream (no meaningful saved position).
  const resumeSeconds =
    startAtSeconds === undefined &&
    detail &&
    !isLive &&
    !isUpcoming &&
    Number.isFinite(userId) &&
    userId > 0
      ? getWatchResumeSeconds(db, userId, videoId, detail.durationSeconds)
      : null;
  const effectiveStartAtSeconds = startAtSeconds ?? resumeSeconds ?? undefined;

  // Pre-warm the adaptive-formats cache in parallel with the page render:
  // the client's first manifest request (/dash or /hls) otherwise pays the
  // ~3s upstream formats fetch on its critical path.
  if (detail && !isLive && !isUpcoming) {
    void fetchAdaptiveFormats(videoId).catch(() => {});
  }

  // Already-watched videos open at rest: poster + chrome, no autoplay
  // (whatever the setting says), position back at the start.
  const videoWatched =
    Number.isFinite(userId) && userId > 0
      ? isVideoWatched(db, userId, videoId)
      : false;

  // The detail payload usually already carries related videos; only spend the
  // extra upstream round-trip when it doesn't have enough to fill the sidebar.
  const RELATED_SIDEBAR_TARGET = 20;
  const detailRelatedCount = (detail?.relatedVideos ?? []).filter(
    (v) => v.videoId !== videoId,
  ).length;
  const relatedResult =
    detail && detailRelatedCount < RELATED_SIDEBAR_TARGET
      ? await fetchRelatedVideos(db, input, 24, overrides).catch(() => null)
      : null;

  const applyRestrictedFilter = (videos: UnifiedVideo[]) =>
    userSettings?.hideRestrictedVideos === false
      ? videos
      : stripRestrictedListVideos(videos);

  const relatedMerged = new Map<string, UnifiedVideo>();
  for (const v of [
    ...(detail?.relatedVideos ?? []),
    ...(relatedResult?.videos ?? []),
  ]) {
    if (v.videoId !== videoId) relatedMerged.set(v.videoId, v);
  }
  let sidebarVideos = applyRestrictedFilter([...relatedMerged.values()]).slice(
    0,
    20,
  );

  let sidebarFromFeedFallback = false;
  if (sidebarVideos.length === 0) {
    const feedVideosRaw = isAuthed
      ? (
          await getRecommendations(db, userId, {
            page: 1,
            pageSize: 28,
            region: feedRegion,
            overrides,
          })
        ).videos
      : (
          await fetchTrendingVideos(
            db,
            { region: feedRegion, limit: 28 },
            overrides,
          )
        ).videos;
    sidebarVideos = applyRestrictedFilter(feedVideosRaw)
      .filter((v) => v.videoId !== videoId)
      .slice(0, 20);
    sidebarFromFeedFallback = sidebarVideos.length > 0;
  }
  const rawPlayback = detail ? buildWatchPlayback(detail) : null;
  const pipedQualityLimited =
    detail !== null &&
    detail.sourceUsed === "piped" &&
    shouldPreferInvidiousOverPiped(detail);
  const onlyDashOrUnsupported =
    rawPlayback !== null &&
    rawPlayback.kind === "none" &&
    rawPlayback.onlyDashOrUnsupported;
  const videoPayload =
    detail && rawPlayback
      ? rawPlayback.kind === "hls"
        ? {
            mode: "hls" as const,
            src: toProxiedOrDirectPlayback(
              rawPlayback.url,
              appOrigin,
              requestHost,
              detail,
            ),
          }
        : rawPlayback.kind === "progressive"
          ? {
              mode: "progressive" as const,
              variants: toProxiedOrDirectVariants(
                rawPlayback.variants,
                appOrigin,
                requestHost,
                detail,
              ),
            }
          : null
      : null;
  // Subtitle tracks → same-origin `/captions/{id}?label=…` (validating, caching
  // proxy). Both human-authored and auto-generated tracks are included.
  const videoCaptions = detail?.captions?.length
    ? detail.captions.map((c) => ({
        label: c.label,
        languageCode: c.languageCode,
        src: `/captions/${encodeURIComponent(detail.videoId)}?label=${encodeURIComponent(
          c.label,
        )}`,
      }))
    : undefined;
  const poster =
    detail &&
    toProxiedOrDirectPoster(
      detail.thumbnailUrl,
      appOrigin,
      requestHost,
      detail,
    );
  const chapters = parseChaptersFromDescription(
    detail?.description,
    detail?.durationSeconds,
  );
  const publishedLabel = formatPublishedLabel(
    detail?.publishedText,
    detail?.publishedAt,
  );
  const viewsLabel = formatViews(detail?.viewCount);
  const channelLabel = detail?.channelName ?? "Unknown channel";
  const subscribersLabel = formatSubscribersLabel(
    detail?.channelSubscriberCount,
  );
  const scrubPreviewStreamSrc =
    detail && !isLive
      ? (scrubPreviewStreamFromDetail(detail, appOrigin, requestHost) ??
        undefined)
      : undefined;
  const pageTitle =
    detail?.title ?? (ageRestricted ? "Age-restricted video" : "Live stream");
  const upcomingMessage =
    upcomingLive?.message ??
    "This live stream has not started yet. Check back when it goes live.";

  return (
    <WatchCinemaProvider
      initialCinemaMode={Boolean(userSettings?.defaultCinemaMode)}
    >
      <WatchPageGrid
        primary={
          <>
            {pipedQualityLimited ? (
              <p className="mb-3 rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                This video is only available in 360p from your Piped instance
                (no HD streams in the API response). Enable{" "}
                <code className="ot-mono-data text-xs">INVIDIOUS_BASE_URL</code>{" "}
                as a fallback in Settings or fix your Piped extractor so{" "}
                <code className="ot-mono-data text-xs">audioStreams</code> and
                HD <code className="ot-mono-data text-xs">videoStreams</code>{" "}
                are returned.
              </p>
            ) : null}
            {isUpcoming ? (
              <WatchUpcomingLive
                title={pageTitle}
                message={upcomingMessage}
                premiereTimestamp={upcomingLive?.premiereTimestamp}
                publishedText={detail?.publishedText}
              />
            ) : ageRestricted ? (
              <WatchAgeRestricted
                title={pageTitle}
                message={ageRestricted.message}
              />
            ) : videoPayload && detail ? (
              <WatchPlayerMount
                key={detail.videoId}
                isAuthed={isAuthed}
                videoId={detail.videoId}
                payload={videoPayload}
                captions={videoCaptions}
                title={detail.title}
                poster={poster ?? undefined}
                chapters={chapters}
                startAtSeconds={effectiveStartAtSeconds}
                isLive={isLive}
                playbackSourceUsed={
                  detail.sourceUsed === "cache" ? undefined : detail.sourceUsed
                }
                defaultPlaybackQuality={
                  userSettings?.defaultPlaybackQuality ?? "1080p"
                }
                autoplayOnWatch={
                  (userSettings?.autoplayOnWatch ?? true) && !videoWatched
                }
                autoplayNextDefault={userSettings?.autoplayNext}
                sponsorBlockPrefs={
                  userSettings && !isLive
                    ? sponsorBlockPrefsFromAppSettings(userSettings)
                    : undefined
                }
                durationSeconds={detail.durationSeconds}
                storyboard={isLive ? undefined : detail.storyboard}
                scrubPreviewStreamSrc={scrubPreviewStreamSrc}
              />
            ) : (
              <div className="rounded-xl border bg-[hsl(var(--muted))] p-6 text-sm text-[hsl(var(--muted-foreground))]">
                {onlyDashOrUnsupported ? (
                  <span>
                    DASH/MPD is not supported by this player (Invidious only
                    returned an adaptive MPD and no HLS or combined MP4). Try
                    another instance, enable or fix HLS on your Invidious, or
                    check that format streams are not proxy-blocked.
                  </span>
                ) : (
                  "No playable stream is available for this video."
                )}
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1">
                <h1 className="ot-video-card-title m-0 text-2xl font-extrabold leading-8 tracking-tight text-[hsl(var(--foreground))] sm:text-3xl sm:leading-9">
                  {pageTitle}
                </h1>
                <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                  {isLive ? (
                    <span className="rounded-md bg-[hsl(var(--primary))] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                      LIVE
                    </span>
                  ) : null}
                  <span>
                    {viewsLabel ?? null}
                    {viewsLabel && publishedLabel ? " · " : null}
                    {publishedLabel ?? null}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-[hsl(var(--border))] pb-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {detail?.channelId ? (
                    <Link
                      href={`/channel/${encodeURIComponent(detail.channelId)}`}
                    >
                      <ChannelAvatarCircle
                        imageUrl={detail.channelAvatarUrl}
                        label={channelLabel}
                        size="md"
                      />
                    </Link>
                  ) : (
                    <ChannelAvatarCircle
                      imageUrl={detail?.channelAvatarUrl}
                      label={channelLabel}
                      size="md"
                    />
                  )}
                  <div className="min-w-0">
                    {detail?.channelId ? (
                      <Link
                        href={`/channel/${encodeURIComponent(detail.channelId)}`}
                        className="line-clamp-1 text-sm font-semibold text-[hsl(var(--foreground))] hover:underline"
                      >
                        {channelLabel}
                      </Link>
                    ) : (
                      <p className="line-clamp-1 text-sm font-semibold text-[hsl(var(--foreground))]">
                        {channelLabel}
                      </p>
                    )}
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {subscribersLabel ?? "Channel"}
                    </p>
                    {detail?.channelId ? (
                      <div className="mt-1">
                        <WatchChannelTags
                          channelId={detail.channelId}
                          isAuthenticated={isAuthed}
                        />
                      </div>
                    ) : null}
                  </div>
                  {detail?.channelId ? (
                    <div className="ml-auto shrink-0">
                      <ChannelSubscribeButton
                        channelId={detail.channelId}
                        isAuthed={isAuthed}
                        hideUnsubscribeOnMobile
                      />
                    </div>
                  ) : null}
                </div>
                {detail ? (
                  <InteractionButtons
                    videoId={detail.videoId}
                    channelId={detail.channelId}
                    channelName={detail.channelName ?? undefined}
                    title={detail.title}
                    thumbnailUrl={poster ?? undefined}
                    isAuthenticated={isAuthed}
                  />
                ) : null}
              </div>
              {detail?.warning ? (
                <p className="text-sm text-amber-600">{detail.warning}</p>
              ) : null}
            </div>
            {isAuthed && detail && !isUpcoming ? (
              <WatchTracker
                videoId={detail.videoId}
                channelId={detail.channelId}
                videoTitle={detail.title}
                channelName={detail.channelName}
                durationSeconds={detail.durationSeconds}
                isLive={isLive}
              />
            ) : null}

            {detail ? (
              <div className="space-y-3">
                <h2 className="text-lg font-medium">Description</h2>
                <WatchDescription
                  videoId={detail.videoId}
                  description={detail.description}
                  viewsLabel={viewsLabel}
                  publishedLabel={publishedLabel}
                />
              </div>
            ) : null}

            {detail ? <WatchCommentsSection videoId={detail.videoId} /> : null}
          </>
        }
        sidebar={
          <>
            {detail && !isLive ? (
              <WatchChaptersSection
                videoId={detail.videoId}
                chapters={chapters}
                durationSeconds={detail.durationSeconds}
                storyboard={detail.storyboard}
                scrubPreviewStreamSrc={scrubPreviewStreamSrc}
              />
            ) : null}
            <h2 className="text-lg font-bold tracking-tight">
              {sidebarFromFeedFallback
                ? "From your feed"
                : sidebarVideos.length > 0
                  ? "Related"
                  : "More to watch"}
            </h2>
            {sidebarVideos.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                No related videos are available right now. Check your Piped
                instance or try again later.
              </p>
            ) : null}
            <ul className="space-y-3">
              {sidebarVideos.map((video) => (
                <li key={video.videoId}>
                  <VideoCardCompact
                    href={watchHref(video.videoId)}
                    videoId={video.videoId}
                    title={video.title}
                    channelId={video.channelId}
                    channelName={video.channelName}
                    channelHref={
                      video.channelId
                        ? `/channel/${encodeURIComponent(video.channelId)}`
                        : undefined
                    }
                    channelAvatarUrl={video.channelAvatarUrl}
                    thumbnailUrl={video.thumbnailUrl}
                    durationSeconds={video.durationSeconds}
                    isLive={video.isLive}
                    isUpcoming={video.isUpcoming}
                    publishedText={video.publishedText}
                    showChannelAvatar={false}
                    size="large"
                  />
                </li>
              ))}
            </ul>
          </>
        }
      />
    </WatchCinemaProvider>
  );
}
