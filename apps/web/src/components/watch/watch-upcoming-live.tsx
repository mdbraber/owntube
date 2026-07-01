import { formatPublishedAbsoluteLabel } from "@/lib/video-display";

type WatchUpcomingLiveProps = {
  title?: string;
  message: string;
  premiereTimestamp?: number;
  publishedText?: string;
};

export function WatchUpcomingLive({
  title,
  message,
  premiereTimestamp,
  publishedText,
}: WatchUpcomingLiveProps) {
  const premiereLabel = formatPublishedAbsoluteLabel(premiereTimestamp);
  return (
    <div className="ot-surface-card flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.45)] px-6 py-10 text-center">
      <span className="rounded-md bg-[hsl(var(--primary)_/_0.15)] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--primary))]">
        Upcoming
      </span>
      {title ? (
        <p className="m-0 max-w-xl text-lg font-semibold text-[hsl(var(--foreground))]">
          {title}
        </p>
      ) : null}
      <p className="m-0 max-w-lg text-sm text-[hsl(var(--muted-foreground))]">
        {message}
      </p>
      {premiereLabel ? (
        <p className="ot-mono-data m-0 text-xs text-[hsl(var(--muted-foreground))]">
          Scheduled: {premiereLabel}
        </p>
      ) : publishedText ? (
        <p className="m-0 text-xs text-[hsl(var(--muted-foreground))]">
          {publishedText}
        </p>
      ) : null}
    </div>
  );
}
