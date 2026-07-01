"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

export function SubscriptionRow({ channelId }: { channelId: string }) {
  const remove = trpc.subscriptions.remove.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2">
      <Link
        href={`/channel/${encodeURIComponent(channelId)}`}
        className="font-mono text-sm text-[hsl(var(--primary))] hover:underline"
      >
        {channelId}
      </Link>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={remove.isPending}
        onClick={() => remove.mutate({ channelId })}
      >
        Remove
      </Button>
    </li>
  );
}
