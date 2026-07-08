import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PlaylistsOverview } from "@/components/playlists/playlists-overview";
import { auth } from "@/server/auth";

export default async function PlaylistsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/playlists");
  }

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Playlists"
        subtitle="Local playlists stored in your owntube database."
      />
      <PlaylistsOverview />
    </main>
  );
}
