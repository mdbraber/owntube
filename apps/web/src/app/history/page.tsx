import Link from "next/link";
import { redirect } from "next/navigation";
import { HistoryList } from "@/components/history/history-list";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const caller = await createCaller();
  const items = await caller.history.list({ page: 1, pageSize: 50 });

  return (
    <main className="ot-page space-y-6">
      <PageHeader
        title="History"
        subtitle="Search and manage videos you watched on this instance."
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/search">Search</Link>
        </Button>
      </PageHeader>
      <HistoryList initialItems={items} />
    </main>
  );
}
