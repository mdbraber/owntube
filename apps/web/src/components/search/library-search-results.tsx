import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { VideoCard } from "@/components/videos/video-card";
import { parseLibraryQuery, removeFilterFromQuery } from "@/lib/library-query";
import { watchHref } from "@/lib/yt-routes";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { getUserSettings } from "@/server/settings/profile";
import { createCaller } from "@/server/trpc/caller";

type LibrarySearchResultsProps = {
  query: string;
  page: number;
};

function searchHref(query: string, page?: number): string {
  const q = query.trim();
  if (!q) return "/";
  return `/search?q=${encodeURIComponent(q)}${page && page > 1 ? `&page=${page}` : ""}`;
}

function Notice({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <output
      aria-live="polite"
      className={
        tone === "error"
          ? "block rounded-xl border border-[hsl(var(--destructive)_/_0.4)] bg-[hsl(var(--destructive)_/_0.08)] p-4 text-sm font-medium text-[hsl(var(--destructive))]"
          : "block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] p-4 text-sm text-[hsl(var(--muted-foreground))]"
      }
    >
      {children}
    </output>
  );
}

function LibraryHeader({
  chips,
  summary,
}: {
  chips: { label: string; removeHref: string }[];
  summary?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm">
      <span className="font-semibold text-[hsl(var(--foreground))]">
        Searching your library
      </span>
      {chips.map((chip) => (
        <span
          key={chip.removeHref + chip.label}
          className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--primary)_/_0.35)] bg-[hsl(var(--primary)_/_0.08)] py-0.5 pl-2.5 pr-1 font-mono text-xs text-[hsl(var(--foreground))]"
        >
          {chip.label}
          <Link
            href={chip.removeHref}
            aria-label={`Remove ${chip.label}`}
            title="Remove this filter"
            className="flex h-4 w-4 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            ×
          </Link>
        </span>
      ))}
      {summary ? (
        <span className="ml-auto text-[hsl(var(--muted-foreground))]">
          {summary}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Results for a query with `in:`/`tag:`/`has:` filters: the user's own
 * library, never YouTube. Says so, with the filters as removable chips.
 */
export async function LibrarySearchResults({
  query,
  page,
}: LibrarySearchResultsProps) {
  const session = await auth();
  const userId = session?.user?.id ? Number.parseInt(session.user.id, 10) : NaN;
  if (!Number.isFinite(userId)) {
    return (
      <div className="space-y-4">
        <LibraryHeader chips={[]} />
        <Notice>
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(searchHref(query))}`}
            className="font-semibold text-[hsl(var(--primary))] hover:underline"
          >
            Sign in
          </Link>{" "}
          to search your library.
        </Notice>
      </div>
    );
  }

  const { favoriteTag } = getUserSettings(getDb(), userId);
  const parsed = parseLibraryQuery(query, { favoriteTag });
  if (parsed.kind !== "library") {
    return (
      <div className="space-y-4">
        <LibraryHeader chips={[]} />
        <Notice tone="error">
          {parsed.kind === "error"
            ? parsed.message
            : "This query has no library filters."}
        </Notice>
      </div>
    );
  }

  const chips = parsed.filters.map((f, i) => ({
    label: f.label,
    removeHref: searchHref(removeFilterFromQuery(query, i)),
  }));

  let result: Awaited<
    ReturnType<Awaited<ReturnType<typeof createCaller>>["search"]["library"]>
  >;
  try {
    const caller = await createCaller();
    result = await caller.search.library({ q: query, page });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "BAD_REQUEST") {
      return (
        <div className="space-y-4">
          <LibraryHeader chips={chips} />
          <Notice tone="error">{error.message}</Notice>
        </div>
      );
    }
    throw error;
  }

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const summary = `${result.total} video${result.total === 1 ? "" : "s"}`;

  return (
    <div className="space-y-6">
      <LibraryHeader chips={chips} summary={summary} />
      {result.notices.map((n) => (
        <Notice key={n}>{n}</Notice>
      ))}
      {result.total === 0 && result.notices.length === 0 ? (
        <Notice>
          Nothing in your library matches. Library search covers the videos
          OwnTube has stored: recent uploads of channels you follow or tag, your
          history, saved videos, queue, playlists and memos.
        </Notice>
      ) : null}
      {result.videos.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Videos</h2>
          <ul className="ot-video-grid mx-[-16px] w-[calc(100%_+_2rem)] sm:mx-0 sm:w-full">
            {result.videos.map((v) => (
              <li key={v.videoId} className="h-full">
                <VideoCard
                  href={watchHref(v.videoId)}
                  videoId={v.videoId}
                  title={v.title}
                  channelId={v.channelId}
                  channelName={v.channelName}
                  channelHref={
                    v.channelId
                      ? `/channel/${encodeURIComponent(v.channelId)}`
                      : undefined
                  }
                  thumbnailUrl={v.thumbnailUrl}
                  durationSeconds={v.durationSeconds}
                  viewCount={v.viewCount}
                  publishedText={v.publishedText}
                  publishedAt={v.publishedAt}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="flex items-center justify-center gap-4 text-sm"
        >
          {result.page > 1 ? (
            <Link
              href={searchHref(query, result.page - 1)}
              className="rounded-md px-3 py-1.5 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
            >
              ← Newer
            </Link>
          ) : null}
          <span className="text-[hsl(var(--muted-foreground))]">
            Page {result.page} of {pages}
          </span>
          {result.page < pages ? (
            <Link
              href={searchHref(query, result.page + 1)}
              className="rounded-md px-3 py-1.5 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
            >
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
