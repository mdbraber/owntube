"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { trpc } from "@/trpc/react";

/** Ids per `memos.counts` request (the procedure's input cap). */
const CHUNK = 200;
/** Cards mounting in one render settle within this; then one request. */
const FLUSH_MS = 30;

export type MemoCount = { count: number; latestText: string };

type MemoCountsValue = {
  register: (videoId: string) => void;
  counts: ReadonlyMap<string, MemoCount>;
};

const MemoCountsContext = createContext<MemoCountsValue>({
  register: () => {},
  counts: new Map(),
});

/**
 * Memo markers for video cards without a query per card: each card registers
 * its id, and the ids that mount together (a page, the next infinite-scroll
 * page) are fetched as one `memos.counts` batch. Signed out: nothing.
 */
export function MemoCountsProvider({ children }: { children: ReactNode }) {
  const authed = trpc.auth.session.useQuery().data?.authed ?? false;
  const [batches, setBatches] = useState<string[][]>([]);
  const known = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const ids = [...pending.current].sort();
    pending.current.clear();
    if (ids.length === 0) return;
    const next: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      next.push(ids.slice(i, i + CHUNK));
    }
    setBatches((prev) => [...prev, ...next]);
  }, []);

  const register = useCallback(
    (videoId: string) => {
      if (known.current.has(videoId)) return;
      known.current.add(videoId);
      pending.current.add(videoId);
      if (timer.current === null) {
        timer.current = window.setTimeout(flush, FLUSH_MS);
      }
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const results = trpc.useQueries((t) =>
    batches.map((videoIds) =>
      t.memos.counts({ videoIds }, { enabled: authed, staleTime: 60_000 }),
    ),
  );

  const dataKey = results.map((r) => r.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: dataKey tracks results
  const counts = useMemo(() => {
    const map = new Map<string, MemoCount>();
    for (const r of results) {
      for (const row of r.data ?? []) {
        map.set(row.videoId, { count: row.count, latestText: row.latestText });
      }
    }
    return map;
  }, [dataKey]);

  const value = useMemo(() => ({ register, counts }), [register, counts]);
  return (
    <MemoCountsContext.Provider value={value}>
      {children}
    </MemoCountsContext.Provider>
  );
}

/** This video's memo count and latest text, or null when it has none. */
export function useMemoCount(videoId?: string): MemoCount | null {
  const { register, counts } = useContext(MemoCountsContext);
  useEffect(() => {
    if (videoId) register(videoId);
  }, [register, videoId]);
  return videoId ? (counts.get(videoId) ?? null) : null;
}
