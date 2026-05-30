import Link from "next/link";
import { useMemo } from "react";
import { compactRichTextParts, parseRichText } from "@/lib/watch-rich-text";

type WatchRichTextProps = {
  videoId: string;
  text: string;
  className?: string;
};

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

  return (
    <span className={className}>
      {parts.map((part, partIdx) => {
        if (part.kind === "text") {
          return <span key={`text-${partIdx}`}>{part.value}</span>;
        }
        if (part.kind === "url") {
          return (
            <a
              key={`url-${partIdx}`}
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
            key={`time-${partIdx}`}
            href={`/watch/${encodeURIComponent(videoId)}?t=${part.seconds}`}
            className="font-medium text-[hsl(var(--foreground))] underline decoration-[hsl(var(--primary)_/_0.45)] underline-offset-2 hover:text-[hsl(var(--primary))]"
          >
            {part.value}
          </Link>
        );
      })}
    </span>
  );
}
