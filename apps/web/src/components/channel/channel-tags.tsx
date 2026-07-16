"use client";

import { TagEditor } from "@/components/ui/tag-editor";
import { trpc } from "@/trpc/react";

type Props = {
  channelId: string;
  isAuthed: boolean;
  tone?: "dark" | "card";
  /**
   * Skip the subscription check when the caller already knows the user is
   * subscribed (e.g. the subscriptions list, where every row is a sub) — avoids
   * a per-channel status query there.
   */
  subscribed?: boolean;
};

/**
 * Local per-user tags for a channel (channel header + the All-channels list),
 * rendered with the shared TagEditor. Inline pills link to the subscriptions
 * feed filtered to that tag.
 */
export function ChannelTags({
  channelId,
  isAuthed,
  tone = "dark",
  subscribed,
}: Props) {
  const utils = trpc.useUtils();
  // Tagging is only offered for channels you're subscribed to. Reuses the same
  // query key as the subscribe button, so subscribing reveals the tag editor
  // immediately (no reload) once the shared cache updates.
  const status = trpc.subscriptions.status.useQuery(
    { channelId },
    { enabled: isAuthed && subscribed === undefined },
  );
  const isSubscribed = subscribed ?? status.data?.subscribed ?? false;
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

  if (!isAuthed || !isSubscribed) return null;

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
