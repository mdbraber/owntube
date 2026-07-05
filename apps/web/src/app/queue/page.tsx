import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { QueuePageClient } from "@/components/queue/queue-page-client";
import { auth } from "@/server/auth";

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/queue");
  }

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Queue"
        subtitle="Your up-next list, saved to your account. Drag to reorder, remove with ✕."
      />
      <QueuePageClient />
    </main>
  );
}
