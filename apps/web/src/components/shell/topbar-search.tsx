"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  filterSearchQueryHistory,
  readSearchQueryHistory,
  recordSearchQuery,
} from "@/lib/search-query-history";
import { mergeSearchSuggestions } from "@/lib/search-suggestions-list";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

const DEBOUNCE_MS = 250;
const LISTBOX_ID = "ot-topbar-search-suggestions";

function searchUrl(query: string): string {
  const trimmed = query.trim();
  return trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search";
}

export function TopbarSearch() {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setActiveIndex(-1);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (focus) {
      setHistory(readSearchQueryHistory());
    }
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const historyMatches = useMemo(
    () => filterSearchQueryHistory(history, debouncedQ, 8),
    [history, debouncedQ],
  );

  const upstreamQuery = trpc.search.suggestions.useQuery(
    { q: debouncedQ },
    {
      enabled: panelOpen && debouncedQ.length > 0,
      staleTime: 60_000,
      retry: false,
    },
  );

  const suggestions = useMemo(
    () =>
      mergeSearchSuggestions(
        debouncedQ,
        historyMatches,
        upstreamQuery.data?.suggestions ?? [],
        10,
      ),
    [debouncedQ, historyMatches, upstreamQuery.data?.suggestions],
  );

  const showPanel =
    panelOpen && (suggestions.length > 0 || upstreamQuery.isFetching);

  const navigateToQuery = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      recordSearchQuery(trimmed);
      setHistory(readSearchQueryHistory());
      setQ(trimmed);
      setPanelOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
      router.push(searchUrl(trimmed));
    },
    [router],
  );

  const submit = useCallback(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      router.push("/search");
      return;
    }
    if (activeIndex >= 0 && activeIndex < suggestions.length) {
      navigateToQuery(suggestions[activeIndex] ?? trimmed);
      return;
    }
    recordSearchQuery(trimmed);
    setHistory(readSearchQueryHistory());
    setPanelOpen(false);
    router.push(searchUrl(trimmed));
  }, [activeIndex, navigateToQuery, q, router, suggestions]);

  return (
    <div className="relative block w-full min-w-0 max-w-2xl">
      <form
        aria-label="Global search"
        className={cn(
          "ot-topbar-search-form flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-shell)] border px-3 py-2 transition-[border-color,box-shadow,background] sm:px-3.5 md:gap-2",
          focus
            ? "border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--muted)_/_0.85)] shadow-[0_0_0_4px_hsl(var(--primary)_/_0.08)]"
            : "border-[hsl(var(--border))] bg-[hsl(var(--muted)_/_0.55)]",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="ot-topbar-search-icon shrink-0 text-[hsl(var(--muted-foreground))]"
          aria-hidden
        >
          <title>Search</title>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <label htmlFor="ot-topbar-search" className="sr-only">
          Global search
        </label>
        <input
          ref={inputRef}
          id="ot-topbar-search"
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listboxId : undefined}
          aria-activedescendant={
            showPanel && activeIndex >= 0
              ? `${LISTBOX_ID}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          placeholder="Search videos, channels, topics…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPanelOpen(true);
          }}
          onFocus={() => {
            setFocus(true);
            setPanelOpen(true);
            setHistory(readSearchQueryHistory());
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && panelRef.current?.contains(next)) return;
            setFocus(false);
            window.setTimeout(() => setPanelOpen(false), 120);
          }}
          onKeyDown={(e) => {
            if (!showPanel && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              if (suggestions.length > 0) setPanelOpen(true);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setPanelOpen(false);
              setActiveIndex(-1);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (suggestions.length === 0) return;
              setActiveIndex((i) => (i < suggestions.length - 1 ? i + 1 : 0));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (suggestions.length === 0) return;
              setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            }
          }}
          className="ot-topbar-search-input min-w-0 flex-1 bg-transparent text-base text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))] sm:text-sm"
        />
        <kbd className="ot-topbar-search-shortcut hidden rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-0.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))] sm:inline-block">
          /
        </kbd>
      </form>

      {showPanel ? (
        <div
          ref={panelRef}
          className="ot-topbar-search-panel absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[var(--radius-card)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 shadow-lg"
        >
          <div
            id={listboxId}
            role="listbox"
            aria-label="Search suggestions"
            className="max-h-72 overflow-y-auto"
          >
            {upstreamQuery.isFetching && suggestions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
                Loading suggestions…
              </p>
            ) : null}
            {suggestions.map((suggestion, index) => {
              const fromHistory = historyMatches.some(
                (h) => h.toLowerCase() === suggestion.toLowerCase(),
              );
              return (
                <button
                  key={suggestion}
                  type="button"
                  id={`${LISTBOX_ID}-option-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  className={cn(
                    "ot-topbar-search-option flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]",
                    activeIndex === index && "bg-[hsl(var(--accent))]",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => navigateToQuery(suggestion)}
                >
                  {fromHistory ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="shrink-0 text-[hsl(var(--muted-foreground))]"
                      aria-hidden
                    >
                      <title>Recent</title>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="shrink-0 text-[hsl(var(--muted-foreground))]"
                      aria-hidden
                    >
                      <title>Suggestion</title>
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  )}
                  <span className="min-w-0 truncate">{suggestion}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
