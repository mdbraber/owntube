/** Longest memo text accepted (plain text). */
export const MEMO_TEXT_MAX_LEN = 5000;

/** Cards shown before "Show N earlier memos". */
export const MEMOS_VISIBLE_DEFAULT = 3;

export type MemoSourceView = {
  kind: "direct" | "slack" | "link";
  url: string | null;
  label: string | null;
  author: string | null;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Short local time for a memo header: "27 Nov 14:32", with the year added
 * when it isn't the current one ("27 Nov 2025 14:32").
 */
export function formatMemoTime(
  unixSec: number,
  now: Date = new Date(),
): string {
  const d = new Date(unixSec * 1000);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const year =
    d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${day}${year} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Full local date and time, for the hover title. */
export function formatMemoTimeFull(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Who / where a memo came from, as its header shows it: "You" for a memo typed
 * here, "Anna in #design" for Slack (falling back to whichever part is known),
 * and the label or host name for any other link.
 */
export function memoSourceLabel(source: MemoSourceView): string {
  if (source.kind === "direct") return "You";
  if (source.kind === "slack") {
    if (source.author && source.label) {
      return `${source.author} in ${source.label}`;
    }
    return source.author ?? source.label ?? "Slack";
  }
  if (source.label) return source.label;
  return source.url ? hostOf(source.url) : "Link";
}

/**
 * A memo's Markdown as plain text, for a tooltip or a podcast description:
 * emphasis and code marks go, a link keeps its text (and, with `urls`, its
 * address in brackets).
 */
export function memoPlainText(
  markdown: string,
  opts: { urls?: boolean } = {},
): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\((\S+?)\)/g, (_, text: string, url: string) =>
      opts.urls && text !== url ? `${text} (${url})` : text || url,
    )
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/gm, "$1$2")
    .trim();
}
