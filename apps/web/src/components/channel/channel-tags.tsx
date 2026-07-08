"use client";

import { TagEditor } from "@/components/ui/tag-editor";
import { trpc } from "@/trpc/react";

type Props = {
  channelId: string;
  isAuthed: boolean;
  tone?: "dark" | "card";
};

/**
 * Local per-user tags for a channel (channel header + the All-channels list),
 * rendered with the shared TagEditor. Inline pills link to the subscriptions
 * feed filtered to that tag.
 */
export function ChannelTags({ channelId, isAuthed, tone = "dark" }: Props) {
  const utils = trpc.useUtils();
  const { data: tags } = trpc.channelTags.listForChannel.useQuery(
    { channelId },
    { enabled: isAuthed },
  );
  const { data: allTags } = trpc.channelTags.listAll.useQuery(undefined, {
    enabled: isAuthed,
  });

  const applyTags = (next: string[]) => {
    utils.channelTags.listForChannel.setData({ channelId }, next);
    void utils.channelTags.listAll.invalidate();
    void utils.channelTags.assignments.invalidate();
  };
  const add = trpc.channelTags.add.useMutation({
    onSuccess: (res) => applyTags(res.tags),
  });
  const remove = trpc.channelTags.remove.useMutation({
    onSuccess: (res) => applyTags(res.tags),
  });

  if (!isAuthed) return null;

  return (
    <TagEditor
      tags={tags ?? []}
      allTags={allTags ?? []}
      pending={add.isPending || remove.isPending}
      onAdd={(tag) => add.mutate({ channelId, tag })}
      onRemove={(tag) => remove.mutate({ channelId, tag })}
      hrefFor={(tag) => `/subscriptions?tag=${encodeURIComponent(tag)}`}
      tone={tone}
    />
  );
}
