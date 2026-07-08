"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { cn } from "@/lib/utils";
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
    addButton: string;
  }
> = {
  // On the channel banner (white text over a dark image).
  dark: {
    pill: "border-white/20 bg-black/30 text-white/85",
    hash: "text-white/50",
    remove: "text-white/60 transition hover:bg-white/15 hover:text-white",
    addButton:
      "text-white/70 transition hover:border-white/40 hover:text-white",
  },
  // On light card surfaces (the channels list).
  card: {
    pill: "border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.45)] text-[hsl(var(--foreground))]",
    hash: "text-[hsl(var(--muted-foreground))]",
    remove:
      "text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]",
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
 * carries an × to remove it. "+ Tag" opens a picker popover — the app-wide
 * pattern: existing tags are pills that toggle on click (add/remove
 * immediately), with an inline field to create a new one. `tone` adapts the
 * inline pills to dark banners vs light card surfaces; the popover always
 * sits on a card surface.
 */
export function ChannelTags({ channelId, isAuthed, tone = "dark" }: Props) {
  const t = TONES[tone];
  const pill = `${PILL_BASE} ${t.pill}`;
  const utils = trpc.useUtils();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const close = useCallback(() => {
    setOpen(false);
    setValue("");
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  if (!isAuthed) return null;

  const current = tags ?? [];

  const toggleTag = (tag: string) => {
    if (add.isPending || remove.isPending) return;
    if (current.includes(tag)) remove.mutate({ channelId, tag });
    else add.mutate({ channelId, tag });
  };

  const submitNew = () => {
    const norm = normalizeChannelTag(value);
    setValue("");
    if (norm && !current.includes(norm)) {
      add.mutate({ channelId, tag: norm });
    }
  };

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-2">
      {current.map((tag) => (
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

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${pill} font-medium ${t.addButton}`}
      >
        + Tag
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Edit tags"
          className="absolute left-0 top-full z-40 mt-1.5 w-72 max-w-[80vw] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 shadow-lg"
        >
          {(allTags ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pb-2.5">
              {(allTags ?? []).map(({ tag, count }) => {
                const active = current.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={active}
                    title={
                      active
                        ? `Remove "${tag}" from this channel`
                        : `Tag this channel "${tag}"`
                    }
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                      active
                        ? "border-[hsl(var(--primary)_/_0.45)] bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]",
                    )}
                  >
                    {active ? <span aria-hidden>✓</span> : null}
                    {tag}
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        active
                          ? "text-[hsl(var(--primary)_/_0.7)]"
                          : "text-[hsl(var(--muted-foreground))]",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div
            className={cn(
              "flex gap-1.5",
              (allTags ?? []).length > 0 &&
                "border-t border-[hsl(var(--border))] pt-2.5",
            )}
          >
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
              }}
              placeholder="New tag…"
              className="min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.5)] px-2.5 py-1.5 text-xs text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus-visible:border-[hsl(var(--primary)_/_0.5)]"
            />
            <button
              type="button"
              disabled={!normalizeChannelTag(value)}
              onClick={submitNew}
              className="shrink-0 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
