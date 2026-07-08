import { redirect } from "next/navigation";
import { PlaylistDetailClient } from "@/components/playlists/playlist-detail-client";
import { auth } from "@/server/auth";

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/playlists/${id}`)}`);
  }
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    redirect("/playlists");
  }

  return (
    <main className="ot-page space-y-6">
      <PlaylistDetailClient playlistId={playlistId} />
    </main>
  );
}
