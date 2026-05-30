import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard");
  }
  const caller = await createCaller();
  const stats = await caller.stats.dashboard();

  return (
    <main className="ot-page max-w-5xl space-y-8">
      <PageHeader
        title="Algorithm"
        subtitle="Signals from your watch history — your feed stays on your machine."
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
