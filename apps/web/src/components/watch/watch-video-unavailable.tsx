type WatchVideoUnavailableProps = {
  title?: string;
  message: string;
};

/**
 * YouTube refused this video outright (region block, private, removed) —
 * show YouTube's own reason where the player would be. Sibling of
 * WatchAgeRestricted; a different instance won't do better, so no
 * instance-health hints here.
 */
export function WatchVideoUnavailable({
  title,
  message,
}: WatchVideoUnavailableProps) {
  return (
    <div className="ot-surface-card flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.45)] px-6 py-10 text-center">
      <span className="rounded-md bg-[hsl(var(--primary)_/_0.15)] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--primary))]">
        Unavailable
      </span>
      {title ? (
        <p className="m-0 max-w-xl text-lg font-semibold text-[hsl(var(--foreground))]">
          {title}
        </p>
      ) : null}
      <p className="m-0 max-w-lg text-sm text-[hsl(var(--muted-foreground))]">
        {message}
      </p>
      <p className="m-0 max-w-lg text-xs text-[hsl(var(--muted-foreground))]">
        This is YouTube&apos;s answer for this video — the uploader or YouTube
        restricts it, so switching instances won&apos;t help.
      </p>
    </div>
  );
}
