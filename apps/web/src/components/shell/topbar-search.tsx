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
import { hasLibraryFilter, parseLibraryQuery } from "@/lib/library-query";
import {
  type FilterSuggestion,
  libraryFilterSuggestions,
} from "@/lib/library-search-suggestions";
import {
  filterSearchQueryHistory,
  readSearchQueryHistory,
  recordSearchQuery,
} from "@/lib/search-query-history";
import { mergeSearchSuggestions } from "@/lib/search-suggestions-list";
import { cn } from "@/lib/utils";
import { appPathFromYoutubeUrl } from "@/lib/youtube-url";
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

  // A query with in:/tag:/has: filters searches the library: it never goes
  // to YouTube, not even for suggestions.
  const libraryQuery = hasLibraryFilter(debouncedQ);
  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const upstreamQuery = trpc.search.suggestions.useQuery(
    { q: debouncedQ },
    {
      enabled: panelOpen && debouncedQ.length > 0 && !libraryQuery,
      staleTime: 60_000,
      retry: false,
    },
  );
  const typingFilter = /(^|[\s(-])(has|tag|in):/i.test(q);
  const vocabulary = trpc.search.libraryVocabulary.useQuery(undefined, {
    enabled: authed && (typingFilter || libraryQuery),
    staleTime: 60_000,
  });

  const filterSuggestions = useMemo<FilterSuggestion[]>(
    () =>
      panelOpen ? libraryFilterSuggestions(q, vocabulary.data ?? null) : [],
    [panelOpen, q, vocabulary.data],
  );

  const queryProblem = useMemo(() => {
    if (!libraryQuery) return null;
    if (!authed) return "Sign in to search your library.";
    const parsed = parseLibraryQuery(debouncedQ, {
      favoriteTag: vocabulary.data?.favoriteTag ?? "favorite",
    });
    return parsed.kind === "error" ? parsed.message : null;
  }, [authed, debouncedQ, libraryQuery, vocabulary.data?.favoriteTag]);

  const textSuggestions = useMemo(
    () =>
      mergeSearchSuggestions(
        debouncedQ,
        historyMatches,
        libraryQuery ? [] : (upstreamQuery.data?.suggestions ?? []),
        10,
      ),
    [debouncedQ, historyMatches, libraryQuery, upstreamQuery.data?.suggestions],
  );
  // While a filter is being typed, its values replace the text suggestions.
  const filterMode = filterSuggestions.length > 0;
  const suggestions = filterMode
    ? filterSuggestions.map((f) => f.value)
    : textSuggestions;

  // A filter still being typed (`in:`) isn't an error yet.
  const shownProblem = filterMode ? null : queryProblem;

  const showPanel =
    panelOpen &&
    (suggestions.length > 0 ||
      shownProblem !== null ||
      (!libraryQuery && upstreamQuery.isFetching));

  /** Take a filter value into the box and keep typing. */
  const acceptFilter = useCallback((value: string) => {
    setQ(value);
    setDebouncedQ(value.trim());
    setActiveIndex(-1);
    setPanelOpen(true);
    inputRef.current?.focus();
  }, []);

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
      const picked = suggestions[activeIndex] ?? trimmed;
      if (filterMode) acceptFilter(picked);
      else navigateToQuery(picked);
      return;
    }
    // A pasted YouTube link opens its OwnTube page instead of a text search.
    const appPath = appPathFromYoutubeUrl(trimmed);
    if (appPath) {
      setQ("");
      setPanelOpen(false);
      inputRef.current?.blur();
      router.push(appPath);
      return;
    }
    recordSearchQuery(trimmed);
    setHistory(readSearchQueryHistory());
    setPanelOpen(false);
    router.push(searchUrl(trimmed));
  }, [
    acceptFilter,
    activeIndex,
    filterMode,
    navigateToQuery,
    q,
    router,
    suggestions,
  ]);

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
          className="ot-topbar-search-input min-w-0 flex-1 bg-transparent text-base text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))] sm:text-sm [&::-webkit-search-cancel-button]:appearance-none"
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear search"
            // Keep focus on the input (avoid the blur→close race) so clearing
            // leaves the box ready to type again.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQ("");
              setActiveIndex(-1);
              setPanelOpen(true);
              setHistory(readSearchQueryHistory());
              inputRef.current?.focus();
            }}
            className="ot-topbar-search-clear flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        ) : null}
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
            {shownProblem ? (
              <p
                role="alert"
                className="px-3 py-2 text-sm font-medium text-[hsl(var(--destructive))]"
              >
                {shownProblem}
              </p>
            ) : null}
            {filterMode
              ? filterSuggestions.map((f, index) => (
                  <button
                    key={f.value}
                    type="button"
                    id={`${LISTBOX_ID}-option-${index}`}
                    role="option"
                    aria-selected={activeIndex === index}
                    className={cn(
                      "ot-topbar-search-option flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]",
                      activeIndex === index && "bg-[hsl(var(--accent))]",
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => acceptFilter(f.value)}
                  >
                    <span className="shrink-0 rounded bg-[hsl(var(--muted))] px-1 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                      filter
                    </span>
                    <span className="min-w-0 truncate font-mono text-[13px]">
                      {f.label}
                    </span>
                    {f.hint ? (
                      <span className="ml-auto shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
                        {f.hint}
                      </span>
                    ) : null}
                  </button>
                ))
              : null}
            {!filterMode &&
            !libraryQuery &&
            upstreamQuery.isFetching &&
            suggestions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
                Loading suggestions…
              </p>
            ) : null}
            {(filterMode ? [] : suggestions).map((suggestion, index) => {
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
