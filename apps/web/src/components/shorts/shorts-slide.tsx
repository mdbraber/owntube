"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { VideoPlayer } from "@/components/player/video-player";
import { WatchTracker } from "@/components/player/watch-tracker";
import { ShortsVerticalActions } from "@/components/shorts/shorts-vertical-actions";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { isIosLikeBrowser } from "@/lib/ios-playback";
import { getMediaOrigin } from "@/lib/media-origin";
import {
  aspectRatioFromPixelDimensions,
  inferShortAspectRatioFromDetail,
} from "@/lib/short-video-aspect";
import { cn } from "@/lib/utils";
import {
  formatPublishedAbsoluteLabel,
  formatPublishedLabel,
} from "@/lib/video-display";
import { buildVideoPlayerPayloadFromDetail } from "@/lib/watch-player-payload";
import { watchHref } from "@/lib/yt-routes";
import type { UnifiedVideo, VideoDetail } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

type ShortsSlideProps = {
  video: UnifiedVideo;
  active: boolean;
  /** An adjacent slide pre-warmed for an instant swipe: mount the player and
   *  let it attach + buffer + decode the first frame, but don't autoplay. */
  preload?: boolean;
  signedIn?: boolean;
  /** Server-seeded detail so the first short plays without a client fetch. */
  initialDetail?: VideoDetail;
  onWatched?: (videoId: string) => void;
  onEnded: () => void;
};

const SHORT_FRAME_CLASS =
  "relative h-full max-h-full w-auto max-w-full min-w-[12rem]";

export function ShortsSlide({
  video,
  active,
  preload = false,
  signedIn = false,
  initialDetail,
  onWatched,
  onEnded,
}: ShortsSlideProps) {
  const detailQuery = trpc.video.detail.useQuery(
    { videoId: video.videoId },
    {
      // Fetch for the active slide AND a pre-warmed adjacent one (so the player
      // can mount ahead of the swipe); server-seeded `initialData` lets the
      // first short play with no client round-trip.
      enabled: active || preload || initialDetail != null,
      staleTime: 60_000,
      initialData: initialDetail,
    },
  );

  const playback = useMemo(() => {
    if (!detailQuery.data || typeof window === "undefined") return null;
    return buildVideoPlayerPayloadFromDetail(
      detailQuery.data,
      getMediaOrigin(window.location.origin),
      window.location.host,
      { avoidSplitAudioVideo: isIosLikeBrowser() },
    );
  }, [detailQuery.data]);

  const [frameAspect, setFrameAspect] = useState(() =>
    inferShortAspectRatioFromDetail(detailQuery.data),
  );

  useEffect(() => {
    setFrameAspect(inferShortAspectRatioFromDetail(detailQuery.data));
  }, [detailQuery.data]);

  const onVideoIntrinsics = useCallback((width: number, height: number) => {
    setFrameAspect(aspectRatioFromPixelDimensions(width, height));
  }, []);

  useEffect(() => {
    if (!active || !detailQuery.data) return;
    try {
      window.history.replaceState(
        null,
        "",
        `/shorts?v=${encodeURIComponent(video.videoId)}`,
      );
    } catch {
      // ignore
    }
  }, [active, detailQuery.data, video.videoId]);

  const detailReady = active && Boolean(detailQuery.data);

  // Published date — from the feed item, falling back to the resolved detail.
  const publishedText = video.publishedText ?? detailQuery.data?.publishedText;
  const publishedAt = video.publishedAt ?? detailQuery.data?.publishedAt;
  const publishedLabel = formatPublishedLabel(publishedText, publishedAt);
  const publishedAbsolute = formatPublishedAbsoluteLabel(publishedAt);

  // The thumbnail is rendered once as a persistent backdrop in the frame (see
  // below), so the loading/inactive states here don't re-draw it — they just
  // sit over it. That keeps the thumbnail visible the whole time the video is
  // resolving/buffering (no black gap) and behind any letterboxing.
  let body: ReactNode = null;
  if ((active || preload) && playback?.payload) {
    // Mount for the active slide AND a pre-warmed adjacent one. When it's the
    // pre-warm (shortsActive=false) the player attaches + buffers + decodes the
    // first frame but stays paused, so becoming active plays it instantly.
    body = (
      <VideoPlayer
        key={`${video.videoId}-${playback.payload.mode}`}
        videoId={video.videoId}
        payload={playback.payload}
        title={video.title}
        poster={undefined}
        durationSeconds={detailQuery.data?.durationSeconds}
        shortsMode
        shortsActive={active}
        onEnded={onEnded}
        onVideoIntrinsics={onVideoIntrinsics}
      />
    );
  } else if (!active) {
    // Pre-warm slide whose payload isn't ready yet, or an off-screen slide:
    // the thumbnail backdrop stands in.
    body = null;
  } else if (detailQuery.isError) {
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/40 px-6 text-center text-sm text-white/80">
        <p>Could not load this short.</p>
        <Link
          href={watchHref(video.videoId)}
          className="text-[hsl(var(--primary))] hover:underline"
        >
          Open in watch page
        </Link>
      </div>
    );
  } else if (detailReady && !playback?.payload) {
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/40 px-6 text-center text-sm text-white/80">
        <p>
          {playback?.onlyDashOrUnsupported
            ? "This short cannot be played in the browser."
            : "No playable stream for this short."}
        </p>
        <Link
          href={watchHref(video.videoId)}
          className="text-[hsl(var(--primary))] hover:underline"
        >
          Try watch page
        </Link>
      </div>
    );
  } else {
    body = (
      <div className="flex h-full w-full items-end justify-center pb-6 text-sm text-white/80">
        <span className="drop-shadow">Loading…</span>
      </div>
    );
  }

  return (
    <section
      className="relative flex h-full min-h-0 w-full items-center justify-center bg-black px-0 pb-2 pt-0 sm:px-4 sm:pt-2"
      aria-label={video.title}
      data-short-active={active ? "true" : "false"}
    >
      <div className="relative flex h-full max-h-full min-h-0 w-full max-w-4xl items-stretch justify-center gap-2 sm:gap-3">
        <div
          className={cn(
            SHORT_FRAME_CLASS,
            "overflow-hidden rounded-none bg-black ring-0 sm:rounded-xl sm:shadow-2xl sm:ring-1 sm:ring-white/10",
          )}
          style={{ aspectRatio: frameAspect }}
        >
          {/* Persistent thumbnail backdrop: shows while the video resolves and
              buffers (instead of black), and fills behind any letterboxing —
              e.g. a landscape short sits centered over its own blurred-cover
              still rather than black bars. The playing video paints over it. */}
          {video.thumbnailUrl ? (
            <VideoThumbnailImg
              url={video.thumbnailUrl}
              videoId={video.videoId}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading={active ? "eager" : "lazy"}
            />
          ) : null}
          <div className="absolute inset-0">{body}</div>

          {/* Bottom safe-area inset (matching the hidden tab bar) so the phone's
              rounded corners / home indicator don't clip the meta. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 rounded-b-xl bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-12">
            <div className="pointer-events-auto min-w-0 pr-16 sm:pr-1">
              {video.channelId && video.channelName ? (
                <Link
                  href={`/channel/${encodeURIComponent(video.channelId)}`}
                  className="line-clamp-1 text-sm font-semibold text-white hover:underline"
                >
                  {video.channelName}
                </Link>
              ) : null}
              <Link
                href={watchHref(video.videoId)}
                className="mt-1 line-clamp-2 text-sm leading-snug text-white/95 hover:underline"
              >
                {video.title}
              </Link>
              {publishedLabel ? (
                <p
                  className="mt-1 text-xs text-white/70 drop-shadow"
                  title={publishedAbsolute ?? undefined}
                >
                  {publishedLabel}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {active ? (
          <ShortsVerticalActions
            videoId={video.videoId}
            channelId={video.channelId}
            channelName={video.channelName}
            title={video.title}
            className="absolute bottom-0 right-0 z-30 pb-[env(safe-area-inset-bottom)] pr-2 sm:static sm:right-auto sm:bottom-auto sm:self-end sm:pb-6 sm:pr-0"
          />
        ) : null}
      </div>
      {active && signedIn && detailQuery.data ? (
        <WatchTracker
          videoId={video.videoId}
          channelId={video.channelId ?? detailQuery.data.channelId}
          videoTitle={video.title ?? detailQuery.data.title}
          channelName={video.channelName ?? detailQuery.data.channelName}
          durationSeconds={detailQuery.data.durationSeconds}
          isShort
          onWatched={onWatched}
        />
      ) : null}
    </section>
  );
}
