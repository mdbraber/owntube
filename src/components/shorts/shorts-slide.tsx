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
import {
  aspectRatioFromPixelDimensions,
  inferShortAspectRatioFromDetail,
} from "@/lib/short-video-aspect";
import { cn } from "@/lib/utils";
import { buildVideoPlayerPayloadFromDetail } from "@/lib/watch-player-payload";
import type { UnifiedVideo } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

type ShortsSlideProps = {
  video: UnifiedVideo;
  active: boolean;
  signedIn?: boolean;
  onWatched?: (videoId: string) => void;
  onEnded: () => void;
};

const SHORT_FRAME_CLASS =
  "relative h-full max-h-full w-auto max-w-full min-w-[12rem]";

function SlidePoster({
  thumbnailUrl,
  videoId,
}: {
  thumbnailUrl?: string;
  videoId: string;
}) {
  if (!thumbnailUrl) {
    return <div className="h-full w-full bg-zinc-950" />;
  }
  return (
    <VideoThumbnailImg
      url={thumbnailUrl}
      videoId={videoId}
      className="h-full w-full object-contain opacity-80"
      loading="lazy"
    />
  );
}

export function ShortsSlide({
  video,
  active,
  signedIn = false,
  onWatched,
  onEnded,
}: ShortsSlideProps) {
  const detailQuery = trpc.video.detail.useQuery(
    { videoId: video.videoId },
    { enabled: active, staleTime: 60_000 },
  );

  const playback = useMemo(() => {
    if (!detailQuery.data || typeof window === "undefined") return null;
    return buildVideoPlayerPayloadFromDetail(
      detailQuery.data,
      window.location.origin,
      window.location.host,
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

  const waitingForDetail =
    active &&
    !detailQuery.data &&
    (detailQuery.isLoading || detailQuery.isFetching);
  const detailReady = active && Boolean(detailQuery.data);

  let body: ReactNode;
  if (!active) {
    body = (
      <SlidePoster thumbnailUrl={video.thumbnailUrl} videoId={video.videoId} />
    );
  } else if (detailQuery.isError) {
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/80">
        <p>Could not load this short.</p>
        <Link
          href={`/watch/${encodeURIComponent(video.videoId)}`}
          className="text-[hsl(var(--primary))] hover:underline"
        >
          Open in watch page
        </Link>
      </div>
    );
  } else if (waitingForDetail) {
    body = (
      <div className="relative flex h-full w-full items-center justify-center">
        {video.thumbnailUrl ? (
          <VideoThumbnailImg
            url={video.thumbnailUrl}
            videoId={video.videoId}
            className="max-h-full max-w-full object-contain opacity-50"
            loading="eager"
          />
        ) : null}
        <p className="absolute bottom-6 left-0 right-0 z-[1] text-center text-sm text-white/80">
          Loading…
        </p>
      </div>
    );
  } else if (detailReady && !playback?.payload) {
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/80">
        <p>
          {playback?.onlyDashOrUnsupported
            ? "This short cannot be played in the browser."
            : "No playable stream for this short."}
        </p>
        <Link
          href={`/watch/${encodeURIComponent(video.videoId)}`}
          className="text-[hsl(var(--primary))] hover:underline"
        >
          Try watch page
        </Link>
      </div>
    );
  } else if (playback?.payload) {
    body = (
      <VideoPlayer
        key={`${video.videoId}-${playback.payload.mode}`}
        videoId={video.videoId}
        payload={playback.payload}
        title={video.title}
        poster={undefined}
        durationSeconds={detailQuery.data?.durationSeconds}
        shortsMode
        onEnded={onEnded}
        onVideoIntrinsics={onVideoIntrinsics}
      />
    );
  } else {
    body = (
      <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-white/80">
        Loading player…
      </div>
    );
  }

  return (
    <section
      className="relative flex h-full min-h-0 w-full items-center justify-center bg-black px-2 pb-2 pt-2 sm:px-4"
      aria-label={video.title}
      data-short-active={active ? "true" : "false"}
    >
      <div className="flex h-full max-h-full min-h-0 w-full max-w-4xl items-stretch justify-center gap-2 sm:gap-3">
        <div
          className={cn(
            SHORT_FRAME_CLASS,
            "overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10",
          )}
          style={{ aspectRatio: frameAspect }}
        >
          <div className="absolute inset-0">{body}</div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 rounded-b-xl bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-5 pt-12">
            <div className="pointer-events-auto min-w-0 pr-1">
              {video.channelId && video.channelName ? (
                <Link
                  href={`/channel/${encodeURIComponent(video.channelId)}`}
                  className="line-clamp-1 text-sm font-semibold text-white hover:underline"
                >
                  {video.channelName}
                </Link>
              ) : null}
              <Link
                href={`/watch/${encodeURIComponent(video.videoId)}`}
                className="mt-1 line-clamp-2 text-sm leading-snug text-white/95 hover:underline"
              >
                {video.title}
              </Link>
            </div>
          </div>
        </div>

        {active ? (
          <ShortsVerticalActions
            videoId={video.videoId}
            channelId={video.channelId}
            channelName={video.channelName}
            className="shrink-0 self-end pb-6"
          />
        ) : null}
      </div>
      {active && signedIn && detailQuery.data ? (
        <WatchTracker
          videoId={video.videoId}
          channelId={video.channelId ?? detailQuery.data.channelId}
          durationSeconds={detailQuery.data.durationSeconds}
          onWatched={onWatched}
        />
      ) : null}
    </section>
  );
}
