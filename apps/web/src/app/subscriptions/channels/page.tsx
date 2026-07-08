import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SubscriptionChannelsList } from "@/components/subscriptions/subscription-channels-list";
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
        <SubscriptionChannelsList channels={channels} />
      )}
    </main>
  );
}
