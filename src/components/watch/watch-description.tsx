import { WatchRichText } from "@/components/watch/watch-rich-text";

type WatchDescriptionProps = {
  videoId: string;
  description?: string | null;
};

export function WatchDescription({
  videoId,
  description,
}: WatchDescriptionProps) {
  if (!description?.trim()) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        No description available.
      </p>
    );
  }

  const lines = description.split(/\r?\n/);
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="space-y-2 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
        {lines.map((line, lineIdx) => {
          if (line.length === 0)
            return <div key={`blank-${lineIdx}`} className="h-2" />;
          return (
            <p key={`line-${lineIdx}`}>
              <WatchRichText videoId={videoId} text={line} />
            </p>
          );
        })}
      </div>
    </div>
  );
}
