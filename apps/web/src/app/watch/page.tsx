import { HydrationBoundary } from "@tanstack/react-query";
import { createServerSideHelpers } from "@trpc/react-query/server";
import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import superjson from "superjson";
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
import { WatchContentTabs } from "@/components/watch/watch-content-tabs";
import { WatchDescription } from "@/components/watch/watch-description";
import { WatchHashStartTime } from "@/components/watch/watch-hash-start-time";
import { WatchMemos } from "@/components/watch/watch-memos";
import { WatchPageGrid } from "@/components/watch/watch-page-grid";
import { WatchPlayerMount } from "@/components/watch/watch-player-mount";
import { WatchUpcomingLive } from "@/components/watch/watch-upcoming-live";
import { WatchVideoUnavailable } from "@/components/watch/watch-video-unavailable";
import { pickDefaultCaptionIndex } from "@/lib/caption-default";
import { isNativeAppUserAgent } from "@/lib/native-app";
import { sponsorBlockPrefsFromAppSettings } from "@/lib/sponsorblock-prefs";
import { parseChaptersFromDescription } from "@/lib/video-chapters";
import {
  formatPublishedLabel,
  formatSubscribersLabel,
  formatViews,
} from "@/lib/video-display";
import {
  playerPayloadFromDetail,
  previewStreamFromDetail,
} from "@/lib/watch-playback";
import { readWatchParams, type WatchParams } from "@/lib/youtube-url";
import { watchHref } from "@/lib/yt-routes";
import { auth } from "@/server/auth";
import { fetchLiveVideos, fetchVideoDetail } from "@/server/catalog";
import type { UnifiedVideo, VideoDetail } from "@/server/catalog/types";
import { videoDetailInputSchema } from "@/server/catalog/types";
import { getDb } from "@/server/db/client";
import { UpstreamAgeRestrictedError } from "@/server/errors/upstream-age-restricted";
import { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";
import { UpstreamVideoUnavailableError } from "@/server/errors/upstream-video-unavailable";
import {
  getWatchResumeSeconds,
  isVideoWatched,
} from "@/server/history/watch-resume";
import { getRecommendations } from "@/server/recommendation/engine";
import {
  getUserSettings,
  normalizeTrendingRegionStored,
  withoutBlockedChannels,
} from "@/server/settings/profile";
import { createTRPCContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";

type WatchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * YouTube-canonical: the video id lives in `?v=`, the start time in `?t=` (or
 * `?start=`). Read through the same rules as the middleware, so a malformed
 * `v=<id>?si=…` that reaches the page still plays, and an invalid id is a 404.
 */
function readWatchSearch(
  sp: Record<string, string | string[] | undefined>,
): WatchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return readWatchParams(params);
}

export async function generateMetadata({
  searchParams,
}: WatchPageProps): Promise<Metadata> {
  const { videoId } = readWatchSearch(await searchParams);
  if (!videoId) return { title: "Video" };
  const input = videoDetailInputSchema.parse({ videoId });
  try {
    const detail = await fetchVideoDetail(input);
    return { title: detail.title };
  } catch (error) {
    if (error instanceof UpstreamLiveUpcomingError) {
      return { title: "Upcoming live stream" };
    }
    if (error instanceof UpstreamAgeRestrictedError) {
      return { title: "Age-restricted video" };
    }
    if (error instanceof UpstreamVideoUnavailableError) {
      return { title: "Video unavailable" };
    }
    return { title: "Video" };
  }
}

export default async function WatchPage({ searchParams }: WatchPageProps) {
  noStore();
  const sp = await searchParams;
  const { videoId, startSeconds: startAtSeconds } = readWatchSearch(sp);
  if (!videoId) notFound();
  const input = videoDetailInputSchema.parse({ videoId });
  const db = getDb();
  const session = await auth();
  const userId = session?.user?.id ? Number.parseInt(session.user.id, 10) : NaN;
  const h = await headers();
  // The iOS app's player panel (lib/native-app.ts): the page below its native
  // video. "side": a wide panel, whose native column shows Up next, so the
  // page leaves out its own related videos.
  const nativePanel = sp.panel === "1" || sp.panel === "side" ? sp.panel : null;
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
  let unavailable: UpstreamVideoUnavailableError | null = null;
  try {
    detail = await fetchVideoDetail(input);
  } catch (error) {
    if (error instanceof UpstreamLiveUpcomingError) {
      upcomingLive = error;
    } else if (error instanceof UpstreamAgeRestrictedError) {
      ageRestricted = error;
    } else if (error instanceof UpstreamVideoUnavailableError) {
      unavailable = error;
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

  // Already-watched videos open at rest: poster + chrome, no autoplay
  // (whatever the setting says), position back at the start.
  const videoWatched =
    Number.isFinite(userId) && userId > 0
      ? isVideoWatched(db, userId, videoId)
      : false;

  const relatedMerged = new Map<string, UnifiedVideo>();
  for (const v of detail?.relatedVideos ?? []) {
    if (v.videoId !== videoId) relatedMerged.set(v.videoId, v);
  }
  let sidebarVideos = withoutBlockedChannels(
    [...relatedMerged.values()],
    userSettings,
  ).slice(0, 20);

  let sidebarFromFeedFallback = false;
  if (sidebarVideos.length === 0) {
    const feedVideosRaw = isAuthed
      ? (
          await getRecommendations(db, userId, {
            page: 1,
            pageSize: 28,
            region: feedRegion,
          })
        ).videos
      : (await fetchLiveVideos({ limit: 28 })).videos;
    sidebarVideos = feedVideosRaw
      .filter((v) => v.videoId !== videoId)
      .slice(0, 20);
    sidebarFromFeedFallback = sidebarVideos.length > 0;
  }
  const videoPayload = detail ? playerPayloadFromDetail(detail) : null;
  // Subtitle tracks, signed gateway WebVTT, human-authored and automatic. The
  // start track follows the account's caption language (lib/caption-default).
  const defaultCaptionIndex = detail?.captions?.length
    ? pickDefaultCaptionIndex(detail.captions, {
        preferred: userSettings?.captionLanguage,
        originalAudioLanguage: detail.originalLanguage,
      })
    : -1;
  const videoCaptions = detail?.captions?.length
    ? detail.captions.flatMap((c, i) =>
        c.src
          ? [
              {
                label: c.label,
                languageCode: c.languageCode,
                isDefault: i === defaultCaptionIndex,
                src: c.src,
              },
            ]
          : [],
      )
    : undefined;
  const poster = detail?.thumbnailUrl;
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
    (detail && previewStreamFromDetail(detail)) ?? undefined;
  const pageTitle =
    detail?.title ??
    (ageRestricted
      ? "Age-restricted video"
      : unavailable
        ? "Video unavailable"
        : "Live stream");
  const upcomingMessage =
    upcomingLive?.message ??
    "This live stream has not started yet. Check back when it goes live.";

  // Hydrate the first page of comments when it's already cached (the warmer
  // caches comments for likely-next videos), so the watch page doesn't fire a
  // client round-trip for them. cache-only never blocks SSR on upstream; a cold
  // miss simply isn't seeded and the client fetches on mount as before.
  const commentsHelpers = createServerSideHelpers({
    router: appRouter,
    ctx: { ...(await createTRPCContext()), prefetchCacheOnly: true },
    transformer: superjson,
  });
  if (detail && !isLive) {
    await commentsHelpers.video.comments
      .prefetchInfinite({ videoId: detail.videoId, sortBy: "top" })
      .catch(() => {
        // cold cache — client fetches on mount
      });
  }

  // Chapters + related are shared between the sidebar (normal mode) and the
  // cinema-mode tabs; each is mounted in exactly one place at a time.
  const chaptersNode =
    detail && !isLive ? (
      <WatchChaptersSection
        videoId={detail.videoId}
        chapters={chapters}
        durationSeconds={detail.durationSeconds}
        storyboard={detail.storyboard}
        scrubPreviewStreamSrc={scrubPreviewStreamSrc}
      />
    ) : null;
  const relatedNode = detail ? (
    <>
      {sidebarVideos.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No related videos are available right now. Try again later.
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
  ) : null;

  return (
    <HydrationBoundary state={commentsHelpers.dehydrate()}>
      <WatchCinemaProvider
        initialCinemaMode={Boolean(userSettings?.defaultCinemaMode)}
      >
        {startAtSeconds === undefined ? (
          <WatchHashStartTime videoId={videoId} />
        ) : null}
        <WatchPageGrid
          primary={
            <>
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
              ) : unavailable ? (
                <WatchVideoUnavailable
                  title={pageTitle}
                  message={unavailable.reason}
                />
              ) : videoPayload && detail ? (
                <WatchPlayerMount
                  key={detail.videoId}
                  isAuthed={isAuthed}
                  nativeApp={isNativeAppUserAgent(h.get("user-agent"))}
                  nativePanel={nativePanel !== null}
                  channelName={detail.channelName}
                  videoId={detail.videoId}
                  payload={videoPayload}
                  captions={videoCaptions}
                  title={detail.title}
                  poster={poster ?? undefined}
                  chapters={chapters}
                  startAtSeconds={effectiveStartAtSeconds}
                  isLive={isLive}
                  defaultPlaybackQuality={
                    userSettings?.defaultPlaybackQuality ?? "1080p"
                  }
                  fullscreenAutoBestQuality={
                    userSettings?.fullscreenAutoBestQuality ?? false
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
                  No playable stream is available for this video.
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
                  {/* Basis 18rem: the row wraps the action buttons onto their
                      own line before the channel block is squeezed — on phones
                      it used to shrink the name to nothing and push Subscribe
                      over the subscriber count and the buttons. */}
                  <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
                    {detail?.channelId ? (
                      <Link
                        href={`/channel/${encodeURIComponent(detail.channelId)}`}
                        className="shrink-0"
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
                          className="block truncate text-sm font-semibold text-[hsl(var(--foreground))] hover:underline"
                        >
                          {channelLabel}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                          {channelLabel}
                        </p>
                      )}
                      <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
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
                      <div className="ml-auto flex shrink-0 gap-2">
                        {/* Favorite lives on the channel page only. */}
                        <ChannelSubscribeButton
                          channelId={detail.channelId}
                          isAuthed={isAuthed}
                          subscribeOnly
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
              {isAuthed && detail ? (
                <WatchMemos
                  videoId={detail.videoId}
                  channelId={detail.channelId}
                  videoTitle={detail.title}
                  channelName={detail.channelName ?? undefined}
                />
              ) : null}
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
                <WatchContentTabs
                  relatedLabel={
                    sidebarFromFeedFallback
                      ? "From your feed"
                      : sidebarVideos.length > 0
                        ? "Related"
                        : "More to watch"
                  }
                  description={
                    <WatchDescription
                      videoId={detail.videoId}
                      description={detail.description}
                      viewsLabel={viewsLabel}
                      publishedLabel={publishedLabel}
                    />
                  }
                  comments={<WatchCommentsSection videoId={detail.videoId} />}
                  chapters={chaptersNode ?? undefined}
                  related={relatedNode}
                />
              ) : null}
            </>
          }
          sidebar={
            nativePanel === "side" ? (
              chaptersNode
            ) : (
              <>
                {chaptersNode}
                <h2 className="text-lg font-bold tracking-tight">
                  {sidebarFromFeedFallback
                    ? "From your feed"
                    : sidebarVideos.length > 0
                      ? "Related"
                      : "More to watch"}
                </h2>
                {relatedNode}
              </>
            )
          }
        />
      </WatchCinemaProvider>
    </HydrationBoundary>
  );
}
