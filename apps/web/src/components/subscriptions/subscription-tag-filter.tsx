"use client";

export type TagState = "off" | "include" | "exclude";

const BASE_PILL =
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition";

function pillClass(state: TagState): string {
  if (state === "include") {
    return `${BASE_PILL} border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]`;
  }
  if (state === "exclude") {
    return `${BASE_PILL} border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.5)] text-[hsl(var(--muted-foreground))] line-through`;
  }
  return `${BASE_PILL} border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)_/_0.5)] hover:text-[hsl(var(--primary))]`;
}

type Props = {
  tags: { tag: string; count: number }[];
  stateFor: (tag: string) => TagState;
  onCycle: (tag: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
};

/**
 * Tri-state tag filter for the subscriptions feed. Each pill cycles
 * off → include (✓, "only these") → exclude (✗, "hide these") → off, with
 * Show all / Hide all bulk actions.
 */
export function SubscriptionTagFilter({
  tags,
  stateFor,
  onCycle,
  onShowAll,
  onHideAll,
}: Props) {
  if (tags.length === 0) return null;
  const anyActive = tags.some((t) => stateFor(t.tag) !== "off");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-0.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
        Tags
      </span>
      {tags.map(({ tag }) => {
        const state = stateFor(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onCycle(tag)}
            aria-pressed={state !== "off"}
            title={
              state === "include"
                ? "Showing only this tag — click to hide"
                : state === "exclude"
                  ? "Hiding this tag — click to reset"
                  : "Click to show only this tag"
            }
            className={pillClass(state)}
          >
            {state === "include" ? (
              <span aria-hidden>✓</span>
            ) : state === "exclude" ? (
              <span aria-hidden>✕</span>
            ) : null}
            #{tag}
          </button>
        );
      })}
      <span className="mx-1 h-4 w-px bg-[hsl(var(--border))]" aria-hidden />
      <button
        type="button"
        onClick={onShowAll}
        disabled={!anyActive}
        className="rounded-full px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))] disabled:opacity-40"
      >
        Show all
      </button>
      <button
        type="button"
        onClick={onHideAll}
        className="rounded-full px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
      >
        Hide all
      </button>
    </div>
  );
}
