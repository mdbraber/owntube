import { redirect } from "next/navigation";
import { ContinueWatchingPageClient } from "@/components/continue-watching/continue-watching-page-client";
import { PageHeader } from "@/components/layout/page-header";
import { auth } from "@/server/auth";

export default async function ContinueWatchingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/continue");
  }

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Continue watching"
        subtitle="Videos you started but have not finished — pick up where you left off."
      />
      <ContinueWatchingPageClient />
    </main>
  );
}
