import Link from "next/link";
import { redirect } from "next/navigation";
import { ChannelTags } from "@/components/channel/channel-tags";
import { PageHeader } from "@/components/layout/page-header";
import { SubscriptionUnfollowButton } from "@/components/subscriptions/subscription-unfollow-button";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function SubscriptionChannelsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/subscriptions/channels");
  }
  const caller = await createCaller();
  const channels = await caller.subscriptions.listDetailed();

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Following channels"
        subtitle="All channels from your subscriptions list."
      >
        <Link
          href="/subscriptions"
          className="text-sm font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
        >
          Back to Subscriptions
        </Link>
      </PageHeader>

      {channels.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
          You are not following any channels yet.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {channels.map((c) => {
            const label = c.channelName || c.channelId;
            return (
              <li key={c.channelId}>
                <div className="group flex h-full flex-col gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 transition hover:border-[hsl(var(--primary)_/_0.35)]">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/channel/${encodeURIComponent(c.channelId)}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <ChannelAvatarCircle
                        imageUrl={c.avatarUrl ?? undefined}
                        label={label}
                        size="lg"
                      />
                      <span className="block min-w-0 truncate text-sm font-semibold text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--primary))]">
                        {label}
                      </span>
                    </Link>
                    <SubscriptionUnfollowButton channelId={c.channelId} />
                  </div>
                  <ChannelTags channelId={c.channelId} isAuthed tone="card" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
