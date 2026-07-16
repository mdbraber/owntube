import Link from "next/link";
import { watchHref } from "@/lib/yt-routes";
import { useMemo } from "react";
import { compactRichTextParts, parseRichText } from "@/lib/watch-rich-text";

type WatchRichTextProps = {
  videoId: string;
  text: string;
  className?: string;
};

function keyForRichTextPart(
  part: ReturnType<typeof compactRichTextParts>[number],
  partOccurrences: Map<string, number>,
) {
  const base =
    part.kind === "time"
      ? `${part.kind}:${part.value}:${part.seconds}`
      : part.kind === "url"
        ? `${part.kind}:${part.value}:${part.label ?? ""}`
        : `${part.kind}:${part.value}`;
  const occurrence = partOccurrences.get(base) ?? 0;
  partOccurrences.set(base, occurrence + 1);
  return `${base}:${occurrence}`;
}

export function WatchRichText({
  videoId,
  text,
  className,
}: WatchRichTextProps) {
  const parts = useMemo(
    () => compactRichTextParts(parseRichText(text)),
    [text],
  );

  if (parts.length === 0) return null;

  const partOccurrences = new Map<string, number>();
  return (
    <span className={className}>
      {parts.map((part) => {
        const partKey = keyForRichTextPart(part, partOccurrences);
        if (part.kind === "text") {
          return <span key={partKey}>{part.value}</span>;
        }
        if (part.kind === "url") {
          return (
            <a
              key={partKey}
              href={part.value}
              target="_blank"
              rel="noreferrer"
              className="break-all text-[hsl(var(--primary))] underline decoration-[hsl(var(--primary)_/_0.5)] underline-offset-2 hover:text-[hsl(var(--foreground))]"
            >
              {part.label ?? part.value}
            </a>
          );
        }
        return (
          <Link
            key={partKey}
            href={watchHref(videoId, { t: part.seconds })}
            className="font-medium text-[hsl(var(--foreground))] underline decoration-[hsl(var(--primary)_/_0.45)] underline-offset-2 hover:text-[hsl(var(--primary))]"
          >
            {part.value}
          </Link>
        );
      })}
    </span>
  );
}
