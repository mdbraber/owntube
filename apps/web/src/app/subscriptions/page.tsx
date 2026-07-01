import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SubscriptionVideosInfinite } from "@/components/subscriptions/subscription-videos-infinite";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/subscriptions");
  }
  const caller = await createCaller();
  const list = await caller.subscriptions.list();

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Subscriptions"
        subtitle="Uploads from every channel you follow. Manage the list from All channels."
      >
        <Button variant="ghost" size="sm" asChild>
          <Link href="/subscriptions/channels">All channels</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/search">Search channels</Link>
        </Button>
      </PageHeader>

      {list.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] py-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
          You are not subscribed to any channel yet. Open a channel page and
          press Subscribe, or paste a channel ID you know.
        </p>
      ) : (
        <SubscriptionVideosInfinite />
      )}
    </main>
  );
}
