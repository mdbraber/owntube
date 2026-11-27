"use client";

import { useState } from "react";
import { SettingsBlock } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/react";

/**
 * Secret addresses for the podcast feeds: anyone with a feed's
 * URL can read it, no password required, so treat them like the private
 * links they are. Regenerating creates a whole new set of addresses (derived
 * from a password rotated behind the scenes) and takes effect at the next
 * publish cycle, so old subscriptions keep working briefly before they break
 * for good — any podcast app still using the old addresses needs
 * re-subscribing at the new ones afterwards.
 */
export function RssFeedsSection() {
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const query = trpc.settings.rssFeeds.useQuery();
  const regenerate = trpc.settings.regenerateRssPass.useMutation({
    onSuccess: () => {
      setConfirmRegenerate(false);
      void utils.settings.rssFeeds.invalidate();
    },
  });

  const creds = query.data;
  const queueUrls = creds?.queueUrls
    ? ([
        ["audio", creds.queueUrls.audio],
        ["video", creds.queueUrls.video],
      ] as const)
    : null;
  const hasAddresses = Boolean(queueUrls || creds?.feedsUrl);

  const copy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <SettingsBlock>
      <h3 className="text-sm font-medium">Podcast feeds (RSS)</h3>
      <p className="text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        Subscribe to your queue, playlists and channels in a podcast app.
        {hasAddresses
          ? " Each address below is a private link — anyone who has it can read that feed, so share it only with your own podcast app. Getting new addresses changes every one of them."
          : null}{" "}
        Media still only plays on the home network.
      </p>
      {creds ? (
        <div className="space-y-2 text-sm">
          {queueUrls
            ? queueUrls.map(([variant, url]) => (
                <div
                  key={variant}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="text-[hsl(var(--muted-foreground))]">
                    Queue feed ({variant})
                  </span>
                  <code className="max-w-full truncate rounded bg-[hsl(var(--muted))] px-1.5 py-0.5">
                    {url}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copy(variant, url)}
                  >
                    {copied === variant ? "Copied" : "Copy"}
                  </Button>
                </div>
              ))
            : null}
          {creds.feedsUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[hsl(var(--muted-foreground))]">
                All feeds (channels, playlists, saved)
              </span>
              <a
                className="max-w-full truncate underline"
                href={creds.feedsUrl}
                target="_blank"
                rel="noreferrer"
              >
                {creds.feedsUrl}
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copy("feeds", creds.feedsUrl ?? "")}
              >
                {copied === "feeds" ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            {confirmRegenerate ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => regenerate.mutate()}
                  disabled={regenerate.isPending}
                >
                  {regenerate.isPending
                    ? "Regenerating…"
                    : "Yes, break existing subscriptions"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmRegenerate(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmRegenerate(true)}
              >
                Get new feed addresses
              </Button>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            This creates new addresses for every feed and breaks any podcast
            subscription using the old ones. The new addresses reach the feed
            server at the next publish (within ~30 minutes); update your podcast
            apps afterwards.
          </p>
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>
      )}
    </SettingsBlock>
  );
}
