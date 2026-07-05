import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SavedPageClient } from "@/components/saved/saved-page-client";
import { auth } from "@/server/auth";

export default async function SavedPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/saved");
  }

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Saved"
        subtitle="Videos you saved to watch later, kept on your account."
      />
      <SavedPageClient />
    </main>
  );
}
