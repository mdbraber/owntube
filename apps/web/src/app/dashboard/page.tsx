import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/server/auth";
import type { RecommendationReason } from "@/server/services/proxy.types";
import { createCaller } from "@/server/trpc/caller";

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Human label for a recommendation candidate source kind. */
const SOURCE_LABELS: Record<string, string> = {
  history_channel: "Channels you watch",
  subscription: "Subscriptions",
  keyword_search: "Your keywords",
  related: "Related to what you watched",
  trending: "Trending",
  other: "Other",
};

function sourceLabel(kind: string): string {
  return SOURCE_LABELS[kind] ?? kind;
}

function reasonLabel(
  reason: RecommendationReason | null | undefined,
): string | null {
  if (!reason) return null;
  switch (reason.kind) {
    case "topic":
      return reason.terms && reason.terms.length > 0
        ? `Topic · ${reason.terms.join(", ")}`
        : "Topic match";
    case "subscription":
      return reason.channelName
        ? `Subscribed · ${reason.channelName}`
        : "Subscribed channel";
    case "channel":
      return reason.channelName
        ? `You watch · ${reason.channelName}`
        : "Channel you watch";
    case "related":
      return "Related to a watch";
    case "trending":
      return "Trending";
    default:
      return null;
  }
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }
  const caller = await createCaller();
  const [stats, insights] = await Promise.all([
    caller.stats.dashboard(),
    caller.stats.algorithmInsights(),
  ]);

  const maxTopicCount = insights.topTopics[0]?.count ?? 1;
  const totalSources = insights.sourceComposition.reduce(
    (sum, s) => sum + s.count,
    0,
  );

  return (
    <main className="ot-page max-w-5xl space-y-8">
      <PageHeader
        title="Algorithm"
        subtitle="What your feed learned from your watch history — computed locally, nothing leaves your machine."
      >
        <Link
          href="/onboarding/taste?manual=1"
          className="text-sm font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
        >
          Refine recommendations
        </Link>
        <Link
          href="/history"
          className="text-sm font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
        >
          View history
        </Link>
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(
          [
            ["Videos watched", stats.totalHistory.toLocaleString()],
            ["Watch time", fmtDuration(stats.totalWatchSeconds)],
            ["Last 90 days", stats.historyLast90d.toLocaleString()],
            ["Likes", stats.likes.toLocaleString()],
            ["Saved", stats.saved.toLocaleString()],
            ["Dislikes", stats.dislikes.toLocaleString()],
          ] as const
        ).map(([label, value]) => (
          <article key={label} className="ot-surface-card p-5 shadow-sm">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {label}
            </p>
            <p className="mt-1 ot-mono-data text-2xl font-bold tracking-tight">
              {value}
            </p>
          </article>
        ))}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">Topics you like</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Terms the recommender associates with you, weighted by how often
            they drive your current feed.
          </p>
        </div>
        {insights.topTopics.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Not enough signal yet — watch, like, or save a few videos.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {insights.topTopics.map((topic) => {
              const ratio = Math.max(0.18, topic.count / maxTopicCount);
              return (
                <span
                  key={topic.term}
                  className="relative inline-flex items-center overflow-hidden rounded-[var(--radius-shell)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-sm font-medium"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-[hsl(var(--primary)/0.14)]"
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                  <span className="relative">{topic.term}</span>
                </span>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">Your keywords</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Topics you declared in Refine recommendations — they seed searches
            and bias scoring.
          </p>
        </div>
        {insights.keywords.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            None set.{" "}
            <Link
              href="/onboarding/taste?manual=1"
              className="font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
            >
              Add some
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {insights.keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center rounded-[var(--radius-shell)] bg-[hsl(var(--primary)/0.12)] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary))]"
              >
                {kw}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">
            Where your feed comes from
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Source mix of your current recommendation pool ({insights.poolSize}{" "}
            videos).
          </p>
        </div>
        {totalSources === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No pool available right now.
          </p>
        ) : (
          <ul className="space-y-3">
            {insights.sourceComposition.map((s) => {
              const pct = Math.round((s.count / totalSources) * 100);
              return (
                <li key={s.kind} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{sourceLabel(s.kind)}</span>
                    <span className="ot-mono-data text-[hsl(var(--muted-foreground))]">
                      {pct}% · {s.count}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]">
                    <div
                      className="h-full rounded-full bg-[hsl(var(--primary))]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">
            Top picks right now
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            The head of your feed, with why each one was chosen.
          </p>
        </div>
        {insights.topVideos.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No recommendations available right now.
          </p>
        ) : (
          <ol className="space-y-2">
            {insights.topVideos.map((v, i) => {
              const why = reasonLabel(v.reason);
              return (
                <li key={v.videoId} className="ot-surface-card p-4">
                  <div className="flex items-start gap-3">
                    <span className="ot-mono-data mt-0.5 w-6 shrink-0 text-sm text-[hsl(var(--muted-foreground))]">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link
                        href={`/watch/${encodeURIComponent(v.videoId)}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {v.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
                        {v.channelName ? (
                          v.channelId ? (
                            <Link
                              href={`/channel/${encodeURIComponent(v.channelId)}`}
                              className="hover:underline"
                            >
                              {v.channelName}
                            </Link>
                          ) : (
                            <span>{v.channelName}</span>
                          )
                        ) : null}
                        {why ? (
                          <span className="inline-flex items-center rounded-[var(--radius-shell)] bg-[hsl(var(--primary)/0.12)] px-2 py-0.5 font-medium text-[hsl(var(--primary))]">
                            {why}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Top channels (90d)</h2>
        {stats.topChannels.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No data yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {stats.topChannels.map((row) => (
              <li key={row.channelId} className="ot-surface-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/channel/${encodeURIComponent(row.channelId)}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {row.channelName}
                  </Link>
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {row.watchCount} watches · {fmtDuration(row.watchSeconds)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
