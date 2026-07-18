import { unstable_noStore as noStore } from "next/cache";
import { ChannelBlockedBadge } from "@/components/channel/channel-blocked-badge";
import { ChannelSubscribeButton } from "@/components/channel/channel-subscribe-button";
import { ChannelTags } from "@/components/channel/channel-tags";
import { ChannelVideosSection } from "@/components/channel/channel-videos-section";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { formatSubscribersLabel } from "@/lib/video-display";
import { auth } from "@/server/auth";
import { channelPageInputSchema } from "@/server/services/proxy.types";
import { createCaller } from "@/server/trpc/caller";

type ChannelPageProps = {
  params: Promise<{ channelId: string }>;
};

export default async function ChannelPage({ params }: ChannelPageProps) {
  noStore();
  const { channelId: rawId } = await params;
  const input = channelPageInputSchema.parse({ channelId: rawId });
  const session = await auth();
  const isAuthed = Boolean(session?.user?.id);
  const caller = await createCaller();
  let page: Awaited<ReturnType<typeof caller.channel.page>>;
  try {
    page = await caller.channel.page({ channelId: input.channelId });
  } catch {
    // A resolution/upstream failure must not take the whole page down with an
    // unhandled error (which renders a bare 404). Show a retryable state.
    return (
      <main className="ot-page flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-lg font-semibold">Channel unavailable</h1>
        <p className="max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
          We couldn&apos;t load this channel right now. It may be temporarily
          unavailable upstream — please try again in a moment.
        </p>
      </main>
    );
  }
  const channelName = page.name ?? page.channelId;
  const subscribersLabel = formatSubscribersLabel(
    page.subscriberCount ?? undefined,
  );

  return (
    <main className="ot-page space-y-7 pb-8">
      <section className="relative overflow-hidden rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {page.bannerUrl ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: third-party channel banner */}
            <img
              src={page.bannerUrl}
              alt=""
              className="h-[210px] w-full object-cover sm:h-[250px]"
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent"
              aria-hidden
            />
          </>
        ) : (
          <div className="h-[210px] w-full bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)_/_0.3),transparent_50%),radial-gradient(circle_at_bottom_right,hsl(var(--accent)_/_0.3),transparent_45%),hsl(var(--muted)_/_0.35)] sm:h-[250px]" />
        )}

        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
          <div className="rounded-2xl border border-white/10 bg-black/45 p-4 backdrop-blur-md sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-3">
                  <ChannelAvatarCircle
                    imageUrl={page.avatarUrl}
                    label={channelName}
                    size="md"
                  />
                  <h1 className="truncate text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                    {channelName}
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/85 sm:text-sm">
                  {subscribersLabel ? (
                    <span className="inline-flex items-center rounded-full border border-white/20 bg-black/30 px-2.5 py-1">
                      {subscribersLabel}
                    </span>
                  ) : null}
                  <ChannelBlockedBadge
                    channelId={page.channelId}
                    isAuthed={isAuthed}
                  />
                  <ChannelTags channelId={page.channelId} isAuthed={isAuthed} />
                </div>
              </div>
              <div className="shrink-0">
                <ChannelSubscribeButton
                  channelId={page.channelId}
                  isAuthed={isAuthed}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {page.description ? (
        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:p-5">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-[hsl(var(--muted-foreground))] uppercase">
            About
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--foreground))]">
            {page.description}
          </p>
        </section>
      ) : null}

      <ChannelVideosSection
        channelId={page.channelId}
        initialVideos={page.videos}
        initialContinuation={page.continuation}
        sourceUsed={page.sourceUsed}
        stale={page.stale}
      />
    </main>
  );
}
