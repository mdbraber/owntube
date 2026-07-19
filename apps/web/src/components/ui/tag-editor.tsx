"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { cn } from "@/lib/utils";

type Tone = "dark" | "card";

const PILL_BASE =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs sm:text-sm";

const TONES: Record<
  Tone,
  {
    pill: string;
    remove: string;
    addButton: string;
  }
> = {
  // Over dark/colored banners (channel header, playlist header).
  dark: {
    pill: "border-white/20 bg-black/30 text-white/85",
    remove: "text-white/60 transition hover:bg-white/15 hover:text-white",
    addButton:
      "text-white/70 transition hover:border-white/40 hover:text-white",
  },
  // On light card surfaces (the channels list).
  card: {
    pill: "border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.45)] text-[hsl(var(--foreground))]",
    remove:
      "text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]",
    addButton:
      "text-[hsl(var(--muted-foreground))] transition hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]",
  },
};

export type TagEditorProps = {
  /** Tags currently on the subject (channel / playlist). */
  tags: string[];
  /** Every tag the user has for this kind of subject, with usage counts. */
  allTags: { tag: string; count: number }[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  pending?: boolean;
  /** When set, inline pills link here (e.g. filtered subscriptions feed). */
  hrefFor?: (tag: string) => string;
  tone?: Tone;
};

const POPOVER_WIDTH = 288; // w-72
const GAP = 6;
const MARGIN = 8;

/**
 * The app-wide tag editing pattern: inline pills with × to remove, and a
 * "+ Tag" picker popover where existing tags toggle on click (immediate
 * add/remove, usage count shown) plus an inline field to create a new one.
 * Purely presentational — hosts wire the queries/mutations (channel tags,
 * playlist tags).
 *
 * The popover is portaled to <body> and positioned to the button: its host
 * (e.g. the channel banner) uses overflow-hidden + backdrop-blur, which would
 * otherwise clip an in-flow absolute popover so the tags can't be reached.
 */
export function TagEditor({
  tags,
  allTags,
  onAdd,
  onRemove,
  pending = false,
  hrefFor,
  tone = "dark",
}: TagEditorProps) {
  const t = TONES[tone];
  const pill = `${PILL_BASE} ${t.pill}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setValue("");
    setPos(null);
  }, []);

  const reposition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - MARGIN * 2);
    const left = Math.max(
      MARGIN,
      Math.min(r.left, window.innerWidth - width - MARGIN),
    );
    // Default below the button; the layout effect flips it above if it would
    // run off the bottom of the viewport.
    setPos({ top: r.bottom + GAP, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    // Only pull focus (and the mobile keyboard) when typing a new tag is the
    // only thing to do; when there are tags to toggle, don't force the keyboard.
    if (allTags.length === 0) inputRef.current?.focus({ preventScroll: true });
    const onReflow = () => reposition();
    const onPointerDown = (e: PointerEvent) => {
      const node = e.target as Node;
      if (buttonRef.current?.contains(node)) return;
      if (popoverRef.current?.contains(node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, reposition, allTags.length]);

  // Flip above the button when the popover would overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!open || !pos) return;
    const el = popoverRef.current;
    const btn = buttonRef.current;
    if (!el || !btn) return;
    const h = el.offsetHeight;
    if (pos.top + h > window.innerHeight - MARGIN) {
      const r = btn.getBoundingClientRect();
      const above = r.top - GAP - h;
      const next = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - h - MARGIN);
      if (Math.abs(next - pos.top) > 0.5) setPos({ top: next, left: pos.left });
    }
  }, [open, pos]);

  const toggleTag = (tag: string) => {
    if (pending) return;
    if (tags.includes(tag)) onRemove(tag);
    else onAdd(tag);
  };

  const submitNew = () => {
    const norm = normalizeChannelTag(value);
    setValue("");
    if (norm && !tags.includes(norm)) onAdd(norm);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span key={tag} className={pill}>
          {hrefFor ? (
            <Link href={hrefFor(tag)} className="hover:underline">
              #{tag}
            </Link>
          ) : (
            <span>#{tag}</span>
          )}
          <button
            type="button"
            onClick={() => onRemove(tag)}
            aria-label={`Remove tag ${tag}`}
            className={`-mr-1 ml-0.5 flex h-4 w-4 items-center justify-center rounded-full ${t.remove}`}
          >
            ×
          </button>
        </span>
      ))}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${pill} font-medium ${t.addButton}`}
      >
        + Tag
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Edit tags"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: Math.min(POPOVER_WIDTH, window.innerWidth - MARGIN * 2),
              }}
              className="z-[70] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 shadow-lg"
            >
              {allTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pb-2.5">
                  {allTags.map(({ tag, count }) => {
                    const active = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        aria-pressed={active}
                        title={active ? `Remove "${tag}"` : `Add tag "${tag}"`}
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
                  allTags.length > 0 &&
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
                  // 16px (text-base) on mobile prevents iOS from auto-zooming the
                  // page when the field is focused; smaller is fine from sm up.
                  className="min-w-0 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.5)] px-2.5 py-1.5 text-base text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus-visible:border-[hsl(var(--primary)_/_0.5)] sm:text-xs"
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
