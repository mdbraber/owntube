import Link from "next/link";
import { QueueToggleButton } from "@/components/queue/queue-toggle-button";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { VideoCardActionsMenu } from "@/components/videos/video-card-actions-menu";
import { VideoCardDurationBadge } from "@/components/videos/video-card-duration-badge";
import { VideoCardMarkWatchedButton } from "@/components/videos/video-card-mark-watched-button";
import { VideoCardThumbnailImg } from "@/components/videos/video-card-thumbnail-img";
import { VideoCardThumbnailInteractive } from "@/components/videos/video-card-thumbnail-interactive";
import { VideoStatusPills } from "@/components/videos/video-status-pills";
import {
  formatPublishedAbsoluteLabel,
  formatPublishedDebugTitle,
  formatPublishedLabel,
  formatViews,
} from "@/lib/video-display";
import type { RecommendationReason } from "@/server/services/proxy.types";

type VideoCardProps = {
  href: string;
  /** When set, thumbnail hover (1s) plays an inline preview with mute control. */
  videoId?: string;
  title: string;
  channelId?: string;
  channelName?: string;
  channelHref?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  isLive?: boolean;
  isUpcoming?: boolean;
  viewCount?: number;
  /** Relative or textual publish date from upstream (`publishedText`). */
  publishedText?: string;
  /** Unix seconds when available (preferred for accurate relative display). */
  publishedAt?: number;
  /** Personalized feed only — surfaced as a "why recommended" line in the menu. */
  recommendationReason?: RecommendationReason;
  /** Render dimmed (ignored video on a channel page). */
  dimmed?: boolean;
};

export function VideoCard({
  href,
  videoId,
  title,
  channelId,
  channelName,
  channelHref,
  channelAvatarUrl,
  thumbnailUrl,
  durationSeconds,
  isLive,
  isUpcoming,
  viewCount,
  publishedText,
  publishedAt,
  recommendationReason,
  dimmed,
}: VideoCardProps) {
  const viewsLabel = formatViews(viewCount);
  const publishedLabel = formatPublishedLabel(publishedText, publishedAt);
  const publishedAbsoluteLabel = formatPublishedAbsoluteLabel(publishedAt);
  const publishedDebugTitle = formatPublishedDebugTitle(
    publishedText,
    publishedAt,
  );
  const channel = channelName ?? "Unknown channel";

  const thumbShell =
    "ot-video-card-thumbnail relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-[hsl(var(--muted))] shadow-none transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-card-hover)]";
  const thumbImg =
    "h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.04]";

  return (
    <article
      className={`ot-video-card group flex flex-col gap-3 text-left text-[hsl(var(--foreground))]${
        dimmed ? " opacity-40 transition-opacity hover:opacity-75" : ""
      }`}
    >
      {videoId ? (
        <div className="relative">
          <VideoCardThumbnailInteractive
            href={href}
            videoId={videoId}
            thumbnailUrl={thumbnailUrl}
            durationSeconds={durationSeconds}
            isLive={isLive}
            isUpcoming={isUpcoming}
            disableHoverPreview={isLive === true}
            thumbClassName={thumbShell}
            imgClassName={thumbImg}
          />
          <VideoCardMarkWatchedButton
            videoId={videoId}
            channelId={channelId}
            className="absolute left-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
          />
          <VideoStatusPills videoId={videoId} />
        </div>
      ) : (
        <Link href={href} className="block">
          <div className={thumbShell}>
            {thumbnailUrl ? (
              <VideoCardThumbnailImg
                url={thumbnailUrl}
                videoId={videoId}
                className={thumbImg}
              />
            ) : null}
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden
            >
              <svg
                width="56"
                height="56"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="scale-90 text-white drop-shadow-lg transition duration-300 group-hover:scale-100"
              >
                <title>Play</title>
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </div>
            <VideoCardDurationBadge
              durationSeconds={durationSeconds}
              isLive={isLive}
              isUpcoming={isUpcoming}
              className="bottom-2 right-2 px-2 py-0.5 text-[11px]"
            />
            <VideoCardMarkWatchedButton
              videoId={videoId}
              channelId={channelId}
              className="absolute left-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
            />
          </div>
        </Link>
      )}
      <div className="ot-video-card-meta flex items-start gap-3">
        {channelHref ? (
          <Link href={channelHref} className="mt-0.5 shrink-0">
            <ChannelAvatarCircle
              imageUrl={channelAvatarUrl}
              label={channel}
              size="md"
            />
          </Link>
        ) : (
          <ChannelAvatarCircle
            imageUrl={channelAvatarUrl}
            label={channel}
            size="md"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="relative min-w-0 pr-8">
            <Link href={href} className="block min-w-0">
              <h2 className="ot-video-card-title m-0 text-[15px] font-semibold leading-snug tracking-tight text-[hsl(var(--foreground))] transition group-hover:text-[hsl(var(--primary))]">
                {title}
              </h2>
            </Link>
            {videoId ? (
              <VideoCardActionsMenu
                videoId={videoId}
                channelId={channelId}
                channelName={channelName}
                recommendationReason={recommendationReason}
                className="absolute -right-1 -top-1"
              />
            ) : null}
          </div>
          <p className="ot-video-card-byline line-clamp-1 text-[13px] text-[hsl(var(--muted-foreground))]">
            {channelHref ? (
              <Link
                href={channelHref}
                className="hover:text-[hsl(var(--foreground))] hover:underline"
              >
                {channel}
              </Link>
            ) : (
              channel
            )}
            {viewsLabel ? (
              <>
                <span className="mx-1.5 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
                {viewsLabel}
              </>
            ) : null}
            {publishedLabel ? (
              <>
                <span className="mx-1.5 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
                <span
                  className="tabular-nums"
                  title={
                    publishedDebugTitle ?? publishedAbsoluteLabel ?? undefined
                  }
                >
                  {publishedLabel}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
}

type VideoCardShortProps = {
  href: string;
  videoId?: string;
  title: string;
  channelId?: string;
  channelName?: string;
  channelHref?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  isLive?: boolean;
  isUpcoming?: boolean;
  viewCount?: number;
  publishedText?: string;
  publishedAt?: number;
  /** Personalized feed only — surfaced as a "why recommended" line in the menu. */
  recommendationReason?: RecommendationReason;
  /** Show channel name under the title (e.g. search). Off on channel pages. */
  showChannelMeta?: boolean;
  /** Full-width card for the home Shorts shelf (no 210px cap). */
  layout?: "default" | "shelf";
};

export function VideoCardShort({
  href,
  videoId,
  title,
  channelId,
  channelName,
  channelHref,
  thumbnailUrl,
  durationSeconds,
  isLive,
  isUpcoming,
  viewCount,
  publishedText,
  publishedAt,
  recommendationReason,
  showChannelMeta = false,
  layout = "default",
}: VideoCardShortProps) {
  const viewsLabel = formatViews(viewCount);
  const publishedLabel = formatPublishedLabel(publishedText, publishedAt);
  const publishedAbsoluteLabel = formatPublishedAbsoluteLabel(publishedAt);
  const publishedDebugTitle = formatPublishedDebugTitle(
    publishedText,
    publishedAt,
  );
  const channel = channelName ?? "Unknown channel";

  const thumbShellClass =
    layout === "shelf"
      ? "relative w-full"
      : "relative mx-auto w-full max-w-[210px]";
  const titleClass =
    layout === "shelf"
      ? "ot-video-card-title m-0 text-sm font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]"
      : "ot-video-card-title m-0 text-[13px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]";

  return (
    <article className="ot-video-card ot-video-card--short group flex flex-col gap-2 text-left text-[hsl(var(--foreground))]">
      <div className={thumbShellClass}>
        <Link href={href} className="block">
          <div className="ot-video-card-thumbnail relative aspect-[9/16] w-full overflow-hidden rounded-[var(--radius-card)] bg-[hsl(var(--muted))] shadow-none transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-card-hover)]">
            {thumbnailUrl ? (
              <VideoCardThumbnailImg
                url={thumbnailUrl}
                videoId={videoId}
                variant="short"
                className="h-full w-full object-cover object-center transition duration-500 ease-out group-hover:scale-[1.03]"
              />
            ) : null}
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden
            >
              <svg
                width="44"
                height="44"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-white drop-shadow-lg"
              >
                <title>Play</title>
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </div>
            <VideoCardDurationBadge
              durationSeconds={durationSeconds}
              isLive={isLive}
              isUpcoming={isUpcoming}
              className="bottom-1.5 right-1.5 px-1.5 py-px text-[10px]"
            />
          </div>
        </Link>
        <VideoCardMarkWatchedButton
          videoId={videoId}
          channelId={channelId}
          className="absolute left-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
        />
        <VideoStatusPills videoId={videoId} size="sm" />
      </div>
      <div className="px-0.5">
        <div className="relative min-w-0 pr-8">
          <Link href={href} className="block min-w-0">
            <p className={titleClass}>{title}</p>
          </Link>
          {videoId ? (
            <VideoCardActionsMenu
              videoId={videoId}
              channelId={channelId}
              channelName={channelName}
              recommendationReason={recommendationReason}
              className="absolute -right-1 -top-1"
            />
          ) : null}
          {showChannelMeta ? (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-[hsl(var(--muted-foreground))]">
              {channelHref ? (
                <Link
                  href={channelHref}
                  className="hover:text-[hsl(var(--foreground))] hover:underline"
                >
                  {channel}
                </Link>
              ) : (
                channel
              )}
            </p>
          ) : null}
          {viewsLabel || publishedLabel ? (
            <p
              className={
                layout === "shelf"
                  ? "mt-0.5 line-clamp-1 text-xs text-[hsl(var(--muted-foreground))]"
                  : "mt-0.5 line-clamp-1 text-[11px] text-[hsl(var(--muted-foreground))]"
              }
            >
              {viewsLabel}
              {viewsLabel && publishedLabel ? (
                <span className="mx-1 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
              ) : null}
              {publishedLabel ? (
                <span
                  className="tabular-nums"
                  title={
                    publishedDebugTitle ?? publishedAbsoluteLabel ?? undefined
                  }
                >
                  {publishedLabel}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

type VideoCardCompactProps = {
  href: string;
  videoId?: string;
  title: string;
  channelId?: string;
  channelName?: string;
  channelHref?: string;
  channelAvatarUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  isLive?: boolean;
  isUpcoming?: boolean;
  publishedText?: string;
  publishedAt?: number;
  showChannelAvatar?: boolean;
  size?: "default" | "large";
  showAddToQueue?: boolean;
};

export function VideoCardCompact({
  href,
  videoId,
  title,
  channelId,
  channelName,
  channelHref,
  channelAvatarUrl,
  thumbnailUrl,
  durationSeconds,
  isLive,
  isUpcoming,
  publishedText,
  publishedAt,
  showChannelAvatar = true,
  size = "default",
  showAddToQueue = false,
}: VideoCardCompactProps) {
  const publishedLabel = formatPublishedLabel(publishedText, publishedAt);
  const publishedAbsoluteLabel = formatPublishedAbsoluteLabel(publishedAt);
  const publishedDebugTitle = formatPublishedDebugTitle(
    publishedText,
    publishedAt,
  );
  const channel = channelName ?? "Unknown channel";
  const thumbSizeClass =
    size === "large" ? "w-[9.5rem] sm:w-52" : "w-[7.25rem] sm:w-40";
  const titleClass =
    size === "large"
      ? "ot-video-card-title m-0 text-[15px] font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]"
      : "ot-video-card-title m-0 text-sm font-semibold leading-snug tracking-tight transition group-hover:text-[hsl(var(--primary))]";
  const metaPadClass = showChannelAvatar ? "pl-8" : "pl-0";

  return (
    <article className="ot-video-card ot-video-card--compact group rounded-xl p-2 transition hover:bg-[hsl(var(--muted)_/_0.45)]">
      <div className="flex items-start gap-3 text-left">
        <Link href={href} className="block shrink-0">
          <div
            className={`ot-video-card-thumbnail relative aspect-video overflow-hidden rounded-xl bg-[hsl(var(--muted))] ${thumbSizeClass}`}
          >
            {thumbnailUrl ? (
              <VideoCardThumbnailImg
                url={thumbnailUrl}
                videoId={videoId}
                className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
              />
            ) : null}
            <VideoCardDurationBadge
              durationSeconds={durationSeconds}
              isLive={isLive}
              isUpcoming={isUpcoming}
              className="bottom-1 right-1 px-1 py-px text-[10px]"
            />
            <VideoCardMarkWatchedButton
              videoId={videoId}
              channelId={channelId}
              className="absolute left-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
            />
            <VideoStatusPills videoId={videoId} size="sm" />
          </div>
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5 pr-1">
          <div
            className={
              showChannelAvatar
                ? "relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-0.5 pr-8"
                : "relative min-w-0 pr-8"
            }
          >
            {showChannelAvatar ? (
              channelHref ? (
                <Link href={channelHref} className="mt-0.5 shrink-0">
                  <ChannelAvatarCircle
                    imageUrl={channelAvatarUrl}
                    label={channel}
                    size="sm"
                  />
                </Link>
              ) : (
                <span className="mt-0.5 shrink-0">
                  <ChannelAvatarCircle
                    imageUrl={channelAvatarUrl}
                    label={channel}
                    size="sm"
                  />
                </span>
              )
            ) : null}
            <Link href={href} className="min-w-0">
              <p className={titleClass}>{title}</p>
            </Link>
            {videoId ? (
              <VideoCardActionsMenu
                videoId={videoId}
                channelId={channelId}
                channelName={channelName}
                className="absolute -right-1 -top-1"
              />
            ) : null}
          </div>
          <p
            className={`line-clamp-2 text-xs text-[hsl(var(--muted-foreground))] ${metaPadClass}`}
          >
            {channelHref ? (
              <Link
                href={channelHref}
                className="hover:text-[hsl(var(--foreground))] hover:underline"
              >
                {channel}
              </Link>
            ) : (
              channel
            )}
            {publishedLabel ? (
              <>
                <span className="mx-1 text-[hsl(var(--muted-foreground))]/60">
                  ·
                </span>
                <span
                  className="tabular-nums"
                  title={
                    publishedDebugTitle ?? publishedAbsoluteLabel ?? undefined
                  }
                >
                  {publishedLabel}
                </span>
              </>
            ) : null}
          </p>
          {showAddToQueue ? (
            <div className={metaPadClass}>
              <QueueToggleButton
                videoId={href.split("/watch/")[1]?.split("?")[0] ?? ""}
                title={title}
                variant="card"
              />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
