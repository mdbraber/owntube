import Link from "next/link";
import { channelHref, watchHref } from "@/lib/yt-routes";
import { ChannelSubscribeButton } from "@/components/channel/channel-subscribe-button";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { VideoCard } from "@/components/videos/video-card";
import { auth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { UpstreamUnavailableError } from "@/server/errors/upstream-unavailable";
import { searchVideos } from "@/server/services/proxy";
import {
  type SearchVideosResult,
  searchVideosInputSchema,
} from "@/server/services/proxy.types";
import { getUserProxyOverrides } from "@/server/settings/profile";

type SearchResultsProps = {
  query: string;
  sort: "relevance" | "newest" | "views";
};

function sortVideos(
  videos: SearchVideosResult["videos"],
  sort: SearchResultsProps["sort"],
) {
  if (sort === "relevance") return videos;
  const clone = [...videos];
  if (sort === "newest") {
    clone.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    return clone;
  }
  clone.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  return clone;
}

function sortChannels(channels: NonNullable<SearchVideosResult["channels"]>) {
  const clone = [...channels];
  clone.sort((a, b) => (b.subscriberCount ?? 0) - (a.subscriberCount ?? 0));
  return clone;
}

function searchHref(query: string, sort: SearchResultsProps["sort"]) {
  return `/search?q=${encodeURIComponent(query)}&sort=${sort}`;
}

function buildDidYouMeanSuggestions(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string) => {
    const c = candidate.trim();
    if (!c) return;
    const key = c.toLowerCase();
    if (key === q.toLowerCase() || seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  push(q.replace(/[^\p{L}\p{N}\s]/gu, " "));
  push(q.replace(/\s+/g, " "));
  push(q.replace(/\b(official|video|music|lyrics|topic)\b/giu, " "));
  push(
    q
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 4)
      .join(" "),
  );
  return out
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
}

export async function SearchResults({ query, sort }: SearchResultsProps) {
  const input = searchVideosInputSchema.parse({
    q: query,
    limit: 20,
  });
  const db = getDb();
  const session = await auth();
  const userId = session?.user?.id ? Number.parseInt(session.user.id, 10) : NaN;
  const isAuthed = Boolean(session?.user?.id);
  const overrides = getUserProxyOverrides(
    db,
    Number.isFinite(userId) ? userId : null,
  );

  let result: SearchVideosResult;
  try {
    result = await searchVideos(db, input, overrides);
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) {
      return (
        <output
          className="block space-y-2 text-[hsl(var(--muted-foreground))]"
          aria-live="polite"
        >
          <span className="block font-medium text-[hsl(var(--foreground))]">
            Search is temporarily unavailable.
          </span>
          <span className="block whitespace-pre-wrap text-sm">
            {error.message}
          </span>
        </output>
      );
    }
    throw error;
  }

  const channels = sortChannels(result.channels ?? []);
  const videos = sortVideos(result.videos, sort);
  const visibleChannels = channels.slice(0, 6);
  const visibleVideos = videos;
  const noResults = visibleVideos.length === 0 && visibleChannels.length === 0;
  const didYouMean = noResults ? buildDidYouMeanSuggestions(query) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
        <output
          className="block text-sm text-[hsl(var(--muted-foreground))]"
          aria-live="polite"
        >
          {result.videos.length} video
          {result.videos.length === 1 ? "" : "s"}
          {(result.channels?.length ?? 0) > 0
            ? ` · ${result.channels?.length ?? 0} channel${(result.channels?.length ?? 0) === 1 ? "" : "s"}`
            : ""}
          {" · "}
          <span className="font-medium text-[hsl(var(--foreground))]">
            {result.sourceUsed}
          </span>
        </output>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[hsl(var(--muted-foreground))]">Sort:</span>
          {(
            [
              ["relevance", "Relevance"],
              ["newest", "Newest"],
              ["views", "Most viewed"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={searchHref(query, value)}
              className={`rounded-md px-2 py-1 transition ${
                sort === value
                  ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      {result.warning ? (
        <p className="text-sm text-amber-600">{result.warning}</p>
      ) : null}

      {noResults ? (
        <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] p-4 text-sm text-[hsl(var(--muted-foreground))]">
          <p>No results found for "{query}".</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Try fewer words or broader terms.</li>
            <li>
              Try a different sort mode like <strong>Relevance</strong>.
            </li>
            <li>Check your Piped / Invidious instance health in Settings.</li>
          </ul>
          {didYouMean.length > 0 ? (
            <div className="space-y-1">
              <p className="font-medium text-[hsl(var(--foreground))]">
                Did you mean:
              </p>
              <div className="flex flex-wrap gap-2">
                {didYouMean.map((s) => (
                  <Link
                    key={s}
                    href={searchHref(s, "relevance")}
                    className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1 text-xs text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]"
                  >
                    {s}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {visibleChannels.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Channels</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleChannels.map((c) => (
              <li key={c.channelId}>
                <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition hover:bg-[hsl(var(--muted)_/_0.35)]">
                  <Link
                    href={channelHref(c.channelId)}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <ChannelAvatarCircle
                      imageUrl={c.avatarUrl}
                      label={c.name}
                      size="md"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                        {c.name}
                      </p>
                      {c.subscriberCount ? (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {c.subscriberCount.toLocaleString()} subscribers
                        </p>
                      ) : null}
                    </div>
                  </Link>
                  {isAuthed ? (
                    <div className="shrink-0">
                      <ChannelSubscribeButton
                        channelId={c.channelId}
                        isAuthed={isAuthed}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {channels.length > visibleChannels.length ? (
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              className="inline-block text-sm text-[hsl(var(--primary))] hover:underline"
            >
              Showing top channels ({visibleChannels.length}/{channels.length})
            </Link>
          ) : null}
        </section>
      ) : null}

      {visibleVideos.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Videos</h2>
          <ul className="ot-video-grid">
            {visibleVideos.map((v) => (
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
                  channelAvatarUrl={v.channelAvatarUrl}
                  thumbnailUrl={v.thumbnailUrl}
                  durationSeconds={v.durationSeconds}
                  isLive={v.isLive}
                  isUpcoming={v.isUpcoming}
                  viewCount={v.viewCount}
                  publishedText={v.publishedText}
                  publishedAt={v.publishedAt}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
