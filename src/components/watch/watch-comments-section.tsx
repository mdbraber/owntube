"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WatchRichText } from "@/components/watch/watch-rich-text";
import { ChannelAvatarCircle } from "@/components/videos/channel-avatar-circle";
import { formatCompactCount } from "@/lib/video-display";
import type { CommentSort } from "@/server/services/proxy.types";
import { trpc } from "@/trpc/react";

type WatchCommentsSectionProps = {
  videoId: string;
};

const SORT_OPTIONS: { id: CommentSort; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
];

function CommentRow({
  videoId,
  comment,
}: {
  videoId: string;
  comment: {
    commentId: string;
    author: string;
    authorId?: string;
    text: string;
    publishedText?: string;
    authorAvatarUrl?: string;
    likeCount?: number;
    isPinned?: boolean;
    isHearted?: boolean;
    isVerified?: boolean;
    replyCount?: number;
  };
}) {
  const likes = formatCompactCount(comment.likeCount);
  const authorInner = (
    <span className="line-clamp-1 text-sm font-semibold text-[hsl(var(--foreground))]">
      {comment.author}
      {comment.isVerified ? (
        <span
          className="ml-1 inline-block text-[hsl(var(--primary))]"
          title="Verified"
          aria-hidden
        >
          ✓
        </span>
      ) : null}
    </span>
  );

  return (
    <li className="flex gap-3 py-3">
      {comment.authorId ? (
        <Link
          href={`/channel/${encodeURIComponent(comment.authorId)}`}
          className="shrink-0"
        >
          <ChannelAvatarCircle
            imageUrl={comment.authorAvatarUrl}
            label={comment.author}
            size="md"
          />
        </Link>
      ) : (
        <ChannelAvatarCircle
          imageUrl={comment.authorAvatarUrl}
          label={comment.author}
          size="md"
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {comment.authorId ? (
            <Link
              href={`/channel/${encodeURIComponent(comment.authorId)}`}
              className="hover:underline"
            >
              {authorInner}
            </Link>
          ) : (
            authorInner
          )}
          {comment.publishedText ? (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {comment.publishedText}
            </span>
          ) : null}
          {comment.isPinned ? (
            <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Pinned
            </span>
          ) : null}
          {comment.isHearted ? (
            <span
              className="text-xs text-[hsl(var(--primary))]"
              title="Hearted by creator"
            >
              ♥
            </span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[hsl(var(--foreground))]">
          <WatchRichText videoId={videoId} text={comment.text} />
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
          {likes ? <span>{likes} likes</span> : null}
          {comment.replyCount != null && comment.replyCount > 0 ? (
            <span>
              {formatCompactCount(comment.replyCount) ?? comment.replyCount}{" "}
              repl{comment.replyCount === 1 ? "y" : "ies"}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function WatchCommentsSection({ videoId }: WatchCommentsSectionProps) {
  const [sortBy, setSortBy] = useState<CommentSort>("top");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = trpc.video.comments.useInfiniteQuery(
    { videoId, sortBy },
    {
      getNextPageParam: (last) => last.continuation ?? undefined,
    },
  );

  const comments = useMemo(
    () => query.data?.pages.flatMap((p) => p.comments) ?? [],
    [query.data?.pages],
  );

  const firstPage = query.data?.pages[0];
  const disabled = firstPage?.disabled === true;
  const commentCount = firstPage?.commentCount;

  useEffect(() => {
    if (!query.hasNextPage || disabled) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!query.hasNextPage || query.isFetchingNextPage) return;
        void query.fetchNextPage();
      },
      { root: null, rootMargin: "480px 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [query, disabled]);

  const onSortChange = (next: CommentSort) => {
    if (next === sortBy) return;
    setSortBy(next);
  };

  return (
    <section className="space-y-3" aria-labelledby="watch-comments-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="watch-comments-heading"
          className="text-lg font-medium text-[hsl(var(--foreground))]"
        >
          Comments
          {typeof commentCount === "number" && commentCount > 0
            ? ` · ${formatCompactCount(commentCount) ?? commentCount}`
            : comments.length > 0
              ? ` · ${comments.length}${query.hasNextPage ? "+" : ""}`
              : ""}
        </h2>
        <div
          className="flex gap-1 rounded-lg border border-[hsl(var(--border))] p-0.5"
          role="tablist"
          aria-label="Comment sort"
        >
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={
                  active
                    ? "rounded-md bg-[hsl(var(--muted))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--foreground))]"
                    : "rounded-md px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
                }
                onClick={() => onSortChange(opt.id)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {query.isPending ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Loading comments…
        </p>
      ) : null}

      {query.isError ? (
        <p className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] px-4 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Could not load comments. Check your Piped or Invidious instance and
          try again later.
        </p>
      ) : null}

      {!query.isPending && !query.isError && disabled ? (
        <p className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] px-4 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          Comments are disabled on this video.
        </p>
      ) : null}

      {!query.isPending &&
      !query.isError &&
      !disabled &&
      comments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.35)] px-4 py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No comments yet.
        </p>
      ) : null}

      {comments.length > 0 ? (
        <ul className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4">
          {comments.map((comment) => (
            <CommentRow
              key={comment.commentId}
              videoId={videoId}
              comment={comment}
            />
          ))}
        </ul>
      ) : null}

      {query.hasNextPage && !disabled ? (
        <div ref={sentinelRef} className="h-1 w-full shrink-0" aria-hidden />
      ) : null}

      {query.isFetchingNextPage ? (
        <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
          Loading more comments…
        </p>
      ) : null}

      {query.hasNextPage && !query.isFetchingNextPage && !disabled ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.fetchNextPage()}
          >
            Load more comments
          </Button>
        </div>
      ) : null}
    </section>
  );
}
