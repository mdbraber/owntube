import { redirect } from "next/navigation";
import { TaggedChannelsView } from "@/components/favorites/tagged-channels-view";
import { PageHeader } from "@/components/layout/page-header";
import { SectionOptionsMenu } from "@/components/library/section-options-menu";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/trpc/caller";

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/favorites");
  }
  const caller = await createCaller();
  const { favoriteTag } = await caller.settings.get();

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title="Favorites"
        subtitle={`Channels you starred (tagged #${favoriteTag}) and their latest uploads.`}
      >
        <SectionOptionsMenu section="favorites" />
      </PageHeader>
      <TaggedChannelsView
        filter={{ favorites: true }}
        section="favorites"
        empty={
          <>
            No favorites yet. Press the star on a channel page to add it here;
            starring also subscribes.
          </>
        }
      />
    </main>
  );
}
