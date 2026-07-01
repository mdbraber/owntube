"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

type Props = {
  channelId: string;
};

export function SubscriptionUnfollowButton({ channelId }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const remove = trpc.subscriptions.remove.useMutation({
    onSuccess: async () => {
      await utils.subscriptions.invalidate();
      router.refresh();
    },
  });

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="shrink-0 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
      disabled={remove.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        remove.mutate({ channelId });
      }}
    >
      Unfollow
    </Button>
  );
}
