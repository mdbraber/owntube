import { WatchRichText } from "@/components/watch/watch-rich-text";

type WatchDescriptionProps = {
  videoId: string;
  description?: string | null;
  /** "1.2K views" — omitted when unknown. */
  viewsLabel?: string | null;
  /** Relative publish time, e.g. "3 days ago" — omitted when unknown. */
  publishedLabel?: string | null;
};

/** YouTube-style "views · 3 days ago" header for the description box. */
function DescriptionMeta({
  viewsLabel,
  publishedLabel,
}: {
  viewsLabel?: string | null;
  publishedLabel?: string | null;
}) {
  if (!viewsLabel && !publishedLabel) return null;
  return (
    <p className="mb-2 text-sm font-semibold text-[hsl(var(--foreground))]">
      {viewsLabel ?? null}
      {viewsLabel && publishedLabel ? (
        <span className="mx-1.5 text-[hsl(var(--muted-foreground))]/60">·</span>
      ) : null}
      {publishedLabel ?? null}
    </p>
  );
}

function keyForDescriptionLine(
  line: string,
  lineOccurrences: Map<string, number>,
) {
  const occurrence = lineOccurrences.get(line) ?? 0;
  lineOccurrences.set(line, occurrence + 1);
  return `${line}:${occurrence}`;
}

export function WatchDescription({
  videoId,
  description,
  viewsLabel,
  publishedLabel,
}: WatchDescriptionProps) {
  if (!description?.trim()) {
    return (
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
        <DescriptionMeta
          viewsLabel={viewsLabel}
          publishedLabel={publishedLabel}
        />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No description available.
        </p>
      </div>
    );
  }

  const lines = description.split(/\r?\n/);
  const lineOccurrences = new Map<string, number>();
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <DescriptionMeta viewsLabel={viewsLabel} publishedLabel={publishedLabel} />
      <div className="space-y-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
        {lines.map((line) => {
          const lineKey = keyForDescriptionLine(line, lineOccurrences);
          if (line.length === 0)
            return <div key={`blank-${lineKey}`} className="h-2" />;
          return (
            <p key={`line-${lineKey}`}>
              <WatchRichText videoId={videoId} text={line} />
            </p>
          );
        })}
      </div>
    </div>
  );
}
