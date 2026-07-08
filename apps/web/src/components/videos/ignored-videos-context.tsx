"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { trpc } from "@/trpc/react";

type IgnoredVideosValue = {
  /** Videos ignored during this session — used for instant hide/dim. */
  sessionIgnored: ReadonlySet<string>;
  ignore: (videoId: string, channelId?: string) => void;
  /** Inverse of ignore — backs the action toast's Undo. */
  unignore: (videoId: string, channelId?: string) => void;
};

const IgnoredVideosContext = createContext<IgnoredVideosValue>({
  sessionIgnored: new Set(),
  ignore: () => {},
  unignore: () => {},
});

/**
 * Tracks videos the user ignores *this session* so feeds/cards can hide or dim
 * them instantly. The server is the source of truth (feeds already exclude
 * ignored videos and the channel page fetches per-page ignored flags), so we
 * never hydrate the full ignored set into the client — only what was just
 * ignored here.
 */
export function IgnoredVideosProvider({ children }: { children: ReactNode }) {
  const [sessionIgnored, setSessionIgnored] = useState<Set<string>>(
    () => new Set(),
  );
  const setInteraction = trpc.interactions.set.useMutation();

  const ignore = useCallback(
    (videoId: string, channelId?: string) => {
      setSessionIgnored((prev) => {
        const next = new Set(prev);
        next.add(videoId);
        return next;
      });
      setInteraction.mutate({
        videoId,
        channelId,
        type: "ignore",
        active: true,
      });
    },
    [setInteraction],
  );

  const unignore = useCallback(
    (videoId: string, channelId?: string) => {
      setSessionIgnored((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
      setInteraction.mutate({
        videoId,
        channelId,
        type: "ignore",
        active: false,
      });
    },
    [setInteraction],
  );

  const value = useMemo(
    () => ({ sessionIgnored, ignore, unignore }),
    [sessionIgnored, ignore, unignore],
  );
  return (
    <IgnoredVideosContext.Provider value={value}>
      {children}
    </IgnoredVideosContext.Provider>
  );
}

export function useIgnoredVideos(): IgnoredVideosValue {
  return useContext(IgnoredVideosContext);
}
