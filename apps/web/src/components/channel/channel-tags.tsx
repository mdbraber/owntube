"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { trpc } from "@/trpc/react";

const PILL =
  "inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/30 px-2.5 py-1 text-xs text-white/85 sm:text-sm";

type Props = {
  channelId: string;
  isAuthed: boolean;
};

/**
 * Local per-user tags shown on the channel header. Each tag pill links to the
 * subscriptions feed filtered to only that tag and carries an × to remove it;
 * a same-styled "+ Tag" button adds one (with autocomplete from existing tags).
 */
export function ChannelTags({ channelId, isAuthed }: Props) {
  const utils = trpc.useUtils();
  const listId = useId();
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
  };
  const add = trpc.channelTags.add.useMutation({
    onSuccess: (res) => applyTags(res.tags),
  });
  const remove = trpc.channelTags.remove.useMutation({
    onSuccess: (res) => applyTags(res.tags),
  });

  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  if (!isAuthed) return null;

  const submit = () => {
    const norm = normalizeChannelTag(value);
    setValue("");
    setAdding(false);
    if (norm && !(tags ?? []).includes(norm)) {
      add.mutate({ channelId, tag: norm });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(tags ?? []).map((tag) => (
        <span key={tag} className={PILL}>
          <Link
            href={`/subscriptions?tag=${encodeURIComponent(tag)}`}
            className="hover:underline"
          >
            #{tag}
          </Link>
          <button
            type="button"
            onClick={() => remove.mutate({ channelId, tag })}
            aria-label={`Remove tag ${tag}`}
            className="-mr-1 ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white/60 transition hover:bg-white/15 hover:text-white"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <span className={PILL}>
          <span aria-hidden className="text-white/50">
            #
          </span>
          <input
            ref={inputRef}
            list={listId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              else if (e.key === "Escape") {
                setValue("");
                setAdding(false);
              }
            }}
            onBlur={submit}
            placeholder="add tag"
            className="w-24 bg-transparent text-white placeholder:text-white/40 focus:outline-none"
          />
          <datalist id={listId}>
            {(allTags ?? []).map((t) => (
              <option key={t.tag} value={t.tag} />
            ))}
          </datalist>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`${PILL} font-medium text-white/70 transition hover:border-white/40 hover:text-white`}
        >
          + Tag
        </button>
      )}
    </div>
  );
}
