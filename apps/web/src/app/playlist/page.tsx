import { notFound } from "next/navigation";
import { YtPlaylistClient } from "@/components/playlists/yt-playlist-client";

/**
 * Public YouTube playlist viewer. YouTube-canonical: the playlist id lives in
 * `?list=` (channel Playlists tab and playlist links point here).
 */
export default async function YtPlaylistPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string | string[] }>;
}) {
  const { list } = await searchParams;
  const playlistId =
    typeof list === "string"
      ? list.trim()
      : Array.isArray(list)
        ? (list[0]?.trim() ?? "")
        : "";
  if (!playlistId) notFound();
  return (
    <main className="ot-page space-y-6">
      <YtPlaylistClient playlistId={playlistId} />
    </main>
  );
}
