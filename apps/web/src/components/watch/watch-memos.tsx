"use client";

import type { inferRouterOutputs } from "@trpc/server";
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useActionToast } from "@/components/videos/action-toast";
import { TrashIcon } from "@/components/videos/video-action-icons";
import {
  formatMemoTime,
  formatMemoTimeFull,
  MEMO_TEXT_MAX_LEN,
  MEMOS_VISIBLE_DEFAULT,
  memoSourceLabel,
} from "@/lib/memos";
import type { AppRouter } from "@/server/trpc/root";
import { useMemoComposerStore } from "@/stores/memo-composer-store";
import { trpc } from "@/trpc/react";

type Memo = inferRouterOutputs<AppRouter>["memos"]["list"][number];

type WatchMemosProps = {
  videoId: string;
  channelId?: string;
  videoTitle: string;
  channelName?: string;
};

/**
 * Grows a textarea with its content and puts the caret at the end on mount.
 */
function useAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

/**
 * Inline editor for a memo card: saves on blur or Cmd/Ctrl+Enter, cancels on
 * Escape. `onDone` runs once with the trimmed text, or null when cancelled.
 */
function MemoEditor({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  onDone: (text: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const settled = useRef(false);
  useAutosize(ref, value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const finish = (text: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(value.trim());
    }
    // The player's keyboard shortcuts must not fire while typing.
    e.stopPropagation();
  };

  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={2}
      maxLength={MEMO_TEXT_MAX_LEN}
      value={value}
      placeholder="Write a memo…"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(value.trim())}
      className="block w-full resize-none overflow-hidden bg-transparent text-sm leading-6 text-inherit outline-none placeholder:text-[hsl(var(--memo-muted))]"
    />
  );
}

function MemoHeader({ memo }: { memo: Memo }) {
  const label = memoSourceLabel(memo.source);
  const time = formatMemoTime(memo.occurredAt);
  const source =
    memo.source.kind !== "direct" && memo.source.url ? (
      <a
        href={memo.source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold hover:underline"
        title={memo.source.url}
      >
        {label}
      </a>
    ) : (
      <span className="font-semibold">{label}</span>
    );
  return (
    <p className="m-0 flex min-w-0 items-center gap-1 pr-7 text-xs text-[hsl(var(--memo-muted))]">
      <span className="truncate">{source}</span>
      <span aria-hidden="true">·</span>
      <time
        dateTime={new Date(memo.occurredAt * 1000).toISOString()}
        title={formatMemoTimeFull(memo.occurredAt)}
        className="shrink-0"
      >
        {time}
      </time>
    </p>
  );
}

function MemoCard({
  memo,
  editing,
  onEdit,
  onEditDone,
  onDelete,
}: {
  memo: Memo;
  editing: boolean;
  onEdit: () => void;
  onEditDone: (text: string | null) => void;
  onDelete: () => void;
}) {
  const editable = memo.source.kind === "direct";
  return (
    <article className="ot-memo-card relative rounded-xl px-4 pb-3 pt-2.5">
      <MemoHeader memo={memo} />
      <button
        type="button"
        aria-label="Delete memo"
        title="Delete memo"
        onClick={onDelete}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--memo-muted))] transition hover:bg-[hsl(var(--memo-border)_/_0.6)] hover:text-[hsl(var(--memo-foreground))]"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
      <div className="mt-1">
        {editing ? (
          <MemoEditor
            initial={memo.text}
            label="Edit memo"
            onDone={onEditDone}
          />
        ) : editable ? (
          <button
            type="button"
            onClick={onEdit}
            title="Click to edit"
            className="block w-full cursor-text whitespace-pre-wrap break-words text-left text-sm leading-6"
          >
            {memo.text}
          </button>
        ) : (
          <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6">
            {memo.text}
          </p>
        )}
      </div>
    </article>
  );
}

function sourceInputOf(memo: Memo) {
  const s = memo.source;
  if (s.kind === "direct" || !s.url) return undefined;
  const label = s.label ?? undefined;
  const author = s.author ?? undefined;
  return s.kind === "slack"
    ? {
        kind: "slack" as const,
        url: s.url,
        label,
        author,
        workspace: s.workspace ?? undefined,
      }
    : { kind: "link" as const, url: s.url, label, author };
}

/**
 * The user's memos on this video, as sticky notes between the action row and
 * the content tabs (oldest first, the latest three unless expanded). Renders
 * nothing while there are none and no new card is open.
 */
export function WatchMemos({
  videoId,
  channelId,
  videoTitle,
  channelName,
}: WatchMemosProps) {
  const utils = trpc.useUtils();
  const memosQuery = trpc.memos.list.useQuery({ videoId });
  const composing = useMemoComposerStore((s) => s.composingVideoId === videoId);
  const closeComposer = useMemoComposerStore((s) => s.close);
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { showToast } = useActionToast();

  // Leaving the video closes a new card it had open.
  useEffect(() => () => closeComposer(), [closeComposer]);

  const key = { videoId };
  const refresh = () => {
    void utils.memos.list.invalidate(key);
    void utils.memos.counts.invalidate();
  };
  const onError = (error: { message: string }) => {
    showToast(`Memo not saved: ${error.message}`);
    refresh();
  };

  const add = trpc.memos.add.useMutation({
    onMutate: ({ text, occurredAt }) => {
      const now = Math.floor(Date.now() / 1000);
      const at = typeof occurredAt === "number" ? occurredAt : now;
      utils.memos.list.setData(key, (old) => [
        ...(old ?? []),
        {
          // Temporary until the refetch brings the stored row.
          id: -Date.now(),
          videoId,
          channelId: channelId ?? null,
          text,
          occurredAt: at,
          createdAt: now,
          updatedAt: now,
          source: {
            kind: "direct",
            url: null,
            label: null,
            author: null,
            workspace: null,
          },
        },
      ]);
    },
    onError,
    onSettled: refresh,
  });
  const update = trpc.memos.update.useMutation({
    onMutate: ({ id, text }) => {
      utils.memos.list.setData(key, (old) =>
        old?.map((m) => (m.id === id ? { ...m, text } : m)),
      );
    },
    onError,
    onSettled: refresh,
  });
  const remove = trpc.memos.remove.useMutation({
    onMutate: ({ id }) => {
      utils.memos.list.setData(key, (old) => old?.filter((m) => m.id !== id));
    },
    onError,
    onSettled: refresh,
  });

  const memos = memosQuery.data ?? [];
  if (memos.length === 0 && !composing) return null;

  const hidden =
    showAll || memos.length <= MEMOS_VISIBLE_DEFAULT
      ? 0
      : memos.length - MEMOS_VISIBLE_DEFAULT;
  const visible = memos.slice(hidden);

  const onNewDone = (text: string | null) => {
    closeComposer();
    if (!text) return;
    add.mutate({ videoId, channelId, videoTitle, channelName, text });
  };

  const onDelete = (memo: Memo) => {
    remove.mutate({ id: memo.id });
    showToast("Memo deleted", {
      undo: () =>
        add.mutate({
          videoId,
          channelId: memo.channelId ?? channelId,
          videoTitle,
          channelName,
          text: memo.text,
          occurredAt: memo.occurredAt,
          source: sourceInputOf(memo),
        }),
    });
  };

  return (
    <section aria-label="Memos" className="space-y-2">
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline"
        >
          Show {hidden} earlier memo{hidden === 1 ? "" : "s"}
        </button>
      ) : null}
      {visible.map((memo) => (
        <MemoCard
          key={memo.id}
          memo={memo}
          editing={editingId === memo.id}
          onEdit={() => setEditingId(memo.id)}
          onEditDone={(text) => {
            setEditingId(null);
            if (text && text !== memo.text) {
              update.mutate({ id: memo.id, text });
            }
          }}
          onDelete={() => onDelete(memo)}
        />
      ))}
      {composing ? (
        <article className="ot-memo-card relative rounded-xl px-4 pb-3 pt-2.5">
          <p className="m-0 text-xs text-[hsl(var(--memo-muted))]">
            <span className="font-semibold">New memo</span> · saves when you
            click away or press ⌘/Ctrl+Enter · Esc cancels
          </p>
          <div className="mt-1">
            <MemoEditor initial="" label="New memo" onDone={onNewDone} />
          </div>
        </article>
      ) : null}
    </section>
  );
}
