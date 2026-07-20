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
import { trpcClient } from "@/lib/trpc";

/** Below this the bar is noise; above it the video counts as finished. */
const MIN_FRACTION = 0.01;
const COMPLETE_FRACTION = 0.97;
/** Don't resume from the first few seconds — starting over is what's wanted. */
const MIN_RESUME_SECONDS = 5;

type ProgressRow = {
  positionSeconds: number;
  videoDurationSeconds: number | null;
  completed: number;
};

type Store = {
  rows: Map<string, ProgressRow>;
  /** Called after playback so the bars reflect what was just watched. */
  refresh: () => void;
};

const WatchProgressContext = createContext<Store>({
  rows: new Map(),
  refresh: () => {},
});

/**
 * One shared fetch of watch positions, so every thumbnail can show a progress
 * bar and every "open video" can resume — matching the web app. Fetched once
 * per mount and refreshed when returning from the player, rather than queried
 * per card.
 */
export function WatchProgressProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Map<string, ProgressRow>>(new Map());
  const inFlight = useRef(false);

  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    trpcClient.history.progressAll
      .query()
      .then((list) => {
        const next = new Map<string, ProgressRow>();
        for (const row of list) {
          next.set(row.videoId, {
            positionSeconds: row.positionSeconds,
            videoDurationSeconds: row.videoDurationSeconds,
            completed: row.completed,
          });
        }
        setRows(next);
      })
      // Progress is decoration; a failure shouldn't break browsing.
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo(() => ({ rows, refresh: load }), [rows, load]);
  return (
    <WatchProgressContext.Provider value={value}>
      {children}
    </WatchProgressContext.Provider>
  );
}

/** Fraction watched (0..1), or 0 when there is nothing worth drawing. */
export function useWatchedFraction(videoId: string): number {
  const { rows } = useContext(WatchProgressContext);
  const row = rows.get(videoId);
  if (!row) return 0;
  if (row.completed) return 1;
  const duration = row.videoDurationSeconds;
  if (!duration || duration <= 0) return 0;
  const fraction = row.positionSeconds / duration;
  if (fraction < MIN_FRACTION) return 0;
  return Math.min(fraction, 1);
}

/**
 * Seconds to resume a video from, or undefined to start at the beginning —
 * which is what a finished (or barely started) video should do.
 */
export function useResumeLookup(): (videoId: string) => number | undefined {
  const { rows } = useContext(WatchProgressContext);
  return (videoId: string) => {
    const row = rows.get(videoId);
    if (!row || row.completed) return undefined;
    const duration = row.videoDurationSeconds;
    if (duration && row.positionSeconds / duration > COMPLETE_FRACTION)
      return undefined;
    return row.positionSeconds > MIN_RESUME_SECONDS
      ? row.positionSeconds
      : undefined;
  };
}

export function useWatchProgressRefresh(): () => void {
  return useContext(WatchProgressContext).refresh;
}
