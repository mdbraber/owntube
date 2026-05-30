import Link from "next/link";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { VideoThumbnailImg } from "@/components/videos/video-thumbnail-img";
import { formatPublishedLabel, formatViews } from "@/lib/video-display";
import type { UnifiedVideo } from "@/server/services/proxy.types";

type HomeHeroProps = {
  video: UnifiedVideo;
};

export function HomeHero({ video }: HomeHeroProps) {
  const views = formatViews(video.viewCount);
  const published = formatPublishedLabel(video.publishedText);
  return (
    <Link
      href={`/watch/${encodeURIComponent(video.videoId)}`}
      className="group relative mb-7 block aspect-[21/8] max-h-[min(52vw,420px)] min-h-[200px] w-full overflow-hidden rounded-[20px] border border-[hsl(var(--border))] shadow-[0_30px_80px_rgba(0,0,0,0.35)] transition-transform hover:-translate-y-0.5 max-sm:aspect-[4/3] max-sm:max-h-none"
    >
      {video.thumbnailUrl ? (
        <VideoThumbnailImg
          url={video.thumbnailUrl}
          videoId={video.videoId}
          className="absolute inset-0 h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.02]"
          loading="eager"
        />
      ) : (
        <div className="absolute inset-0 bg-[hsl(var(--muted))]" />
      )}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-transparent"
        aria-hidden
      />
      <div className="absolute inset-x-0 bottom-0 max-w-[720px] p-6 text-white max-sm:p-5 sm:px-9 sm:pb-8">
        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/50 px-3 py-1 text-xs font-medium text-white/95 backdrop-blur-md">
          <span
            className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(34,197,94,0.25)]"
            aria-hidden
          />
          Top pick for you
        </span>
        <h2 className="mb-1 text-2xl font-extrabold leading-tight tracking-tight [text-shadow:0_2px_24px_rgba(0,0,0,0.6)] max-sm:text-xl sm:text-4xl sm:leading-[1.08]">
          {video.title}
        </h2>
        <div className="mb-5 flex flex-wrap items-center gap-2.5 text-sm text-white/85">
          <span className="inline-flex items-center gap-2">
            <ChannelAvatarCircle
              imageUrl={video.channelAvatarUrl}
              label={video.channelName ?? "Channel"}
              size="md"
            />
            <span>{video.channelName ?? "Channel"}</span>
          </span>
          {views ? (
            <>
              <span className="h-1 w-1 rounded-full bg-white/50" aria-hidden />
              <span>{views}</span>
            </>
          ) : null}
          {published ? (
            <>
              <span className="h-1 w-1 rounded-full bg-white/50" aria-hidden />
              <span className="tabular-nums">{published}</span>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 shadow-lg transition group-hover:shadow-xl">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <title>Play</title>
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
            Play now
          </span>
        </div>
      </div>
    </Link>
  );
}
