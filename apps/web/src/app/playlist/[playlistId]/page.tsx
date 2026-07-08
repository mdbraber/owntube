import { YtPlaylistClient } from "@/components/playlists/yt-playlist-client";

/** Public YouTube playlist viewer (channel Playlists tab links here). */
export default async function YtPlaylistPage({
  params,
}: {
  params: Promise<{ playlistId: string }>;
}) {
  const { playlistId } = await params;
  return (
    <main className="ot-page space-y-6">
      <YtPlaylistClient playlistId={playlistId} />
    </main>
  );
}
