"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { trpc } from "@/trpc/react";

type Tone = "dark" | "card";

const PILL_BASE =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs sm:text-sm";

const TONES: Record<
  Tone,
  {
    pill: string;
    hash: string;
    remove: string;
    input: string;
    addButton: string;
  }
> = {
  // On the channel banner (white text over a dark image).
  dark: {
    pill: "border-white/20 bg-black/30 text-white/85",
    hash: "text-white/50",
    remove: "text-white/60 transition hover:bg-white/15 hover:text-white",
    input: "text-white placeholder:text-white/40",
    addButton:
      "text-white/70 transition hover:border-white/40 hover:text-white",
  },
  // On light card surfaces (the channels list).
  card: {
    pill: "border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.45)] text-[hsl(var(--foreground))]",
    hash: "text-[hsl(var(--muted-foreground))]",
    remove:
      "text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]",
    input:
      "text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]",
    addButton:
      "text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]",
  },
};

type Props = {
  channelId: string;
  isAuthed: boolean;
  tone?: Tone;
};

/**
 * Local per-user tags for a channel (channel header + the All-channels list).
 * Each tag pill links to the subscriptions feed filtered to only that tag and
 * carries an × to remove it; a same-styled "+ Tag" button adds one (with
 * autocomplete from existing tags). `tone` adapts colors to dark banners vs
 * light card surfaces.
 */
export function ChannelTags({ channelId, isAuthed, tone = "dark" }: Props) {
  const t = TONES[tone];
  const pill = `${PILL_BASE} ${t.pill}`;
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
        <span key={tag} className={pill}>
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
            className={`-mr-1 ml-0.5 flex h-4 w-4 items-center justify-center rounded-full ${t.remove}`}
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <span className={pill}>
          <span aria-hidden className={t.hash}>
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
            className={`w-24 bg-transparent focus:outline-none ${t.input}`}
          />
          <datalist id={listId}>
            {(allTags ?? []).map((tagOption) => (
              <option key={tagOption.tag} value={tagOption.tag} />
            ))}
          </datalist>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`${pill} font-medium ${t.addButton}`}
        >
          + Tag
        </button>
      )}
    </div>
  );
}
