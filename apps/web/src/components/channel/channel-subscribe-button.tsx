"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

type ChannelSubscribeButtonProps = {
  channelId: string;
  /** When false, show sign-in CTA instead of subscribe actions. */
  isAuthed: boolean;
};

export function ChannelSubscribeButton({
  channelId,
  isAuthed,
}: ChannelSubscribeButtonProps) {
  const utils = trpc.useUtils();
  const status = trpc.subscriptions.status.useQuery(
    { channelId },
    { enabled: isAuthed },
  );
  const add = trpc.subscriptions.add.useMutation({
    onSuccess: async () => {
      await utils.subscriptions.invalidate();
    },
  });
  const remove = trpc.subscriptions.remove.useMutation({
    onSuccess: async () => {
      await utils.subscriptions.invalidate();
    },
  });

  if (!isAuthed) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link
          href={`/login?callbackUrl=/channel/${encodeURIComponent(channelId)}`}
        >
          Sign in to subscribe
        </Link>
      </Button>
    );
  }

  if (status.isLoading) {
    return (
      <Button disabled size="sm" variant="outline">
        …
      </Button>
    );
  }

  const subscribed = status.data?.subscribed ?? false;

  if (subscribed) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ channelId })}
      >
        Unsubscribe
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      disabled={add.isPending}
      onClick={() => add.mutate({ channelId })}
    >
      Subscribe
    </Button>
  );
}
