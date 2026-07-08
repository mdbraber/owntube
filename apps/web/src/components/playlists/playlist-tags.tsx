"use client";

import { TagEditor } from "@/components/ui/tag-editor";
import { trpc } from "@/trpc/react";

type Props = {
  playlistId: number;
  tone?: "dark" | "card";
};

/** Per-user playlist tags, same shared TagEditor pattern as channel tags. */
export function PlaylistTags({ playlistId, tone = "dark" }: Props) {
  const utils = trpc.useUtils();
  const { data: tags } = trpc.playlists.tags.useQuery({ playlistId });
  const { data: allTags } = trpc.playlists.allTags.useQuery();

  const applyTags = (next: string[]) => {
    utils.playlists.tags.setData({ playlistId }, next);
    void utils.playlists.allTags.invalidate();
    void utils.playlists.list.invalidate();
    void utils.playlists.detail.invalidate({ playlistId });
  };
  const add = trpc.playlists.addTag.useMutation({
    onSuccess: (res) => applyTags(res.tags),
  });
  const remove = trpc.playlists.removeTag.useMutation({
    onSuccess: (res) => applyTags(res.tags),
  });

  return (
    <TagEditor
      tags={tags ?? []}
      allTags={allTags ?? []}
      pending={add.isPending || remove.isPending}
      onAdd={(tag) => add.mutate({ playlistId, tag })}
      onRemove={(tag) => remove.mutate({ playlistId, tag })}
      tone={tone}
    />
  );
}
