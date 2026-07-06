"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { VideoPlayerProps } from "@/components/player/video-player";

/**
 * The active video's full player props (as spread into <VideoPlayer>) plus the
 * auth flag used to gate mini-player persistence off the watch page.
 */
export type ActivePlayer = {
  isAuthed: boolean;
  props: VideoPlayerProps;
};

type PlayerContextValue = {
  active: ActivePlayer | null;
  /** Set (or replace) the active video — called by the watch page. */
  setActive: (next: ActivePlayer) => void;
  /** Stop and tear down the player entirely. */
  clearActive: () => void;
  /** The watch page's player placeholder, present only while on that page. */
  slotEl: HTMLElement | null;
  registerSlot: (el: HTMLElement | null) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

/**
 * Holds the single, persistent player so it survives navigation. The watch page
 * pushes the active video and registers a placeholder slot; PlayerHost renders
 * one <VideoPlayer> and positions it over that slot (full) or in the corner
 * (mini). Keeping one instance means no reload/hitch when leaving /watch.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState<ActivePlayer | null>(null);
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);

  const setActive = useCallback((next: ActivePlayer) => {
    setActiveState((prev) => {
      // Re-adopting the same, already-playing video (e.g. mini → its watch page)
      // must not swap in fresh server props: a new payload / startAtSeconds would
      // make the live player re-init and re-seek (a hitch). Keep its props and
      // only refresh the still-live bits — the cinema bridge and auth.
      if (prev && prev.props.videoId === next.props.videoId) {
        return {
          isAuthed: next.isAuthed,
          props: { ...prev.props, cinema: next.props.cinema },
        };
      }
      return next;
    });
  }, []);
  const clearActive = useCallback(() => {
    setActiveState(null);
  }, []);
  const registerSlot = useCallback((el: HTMLElement | null) => {
    setSlotEl(el);
  }, []);

  const value = useMemo<PlayerContextValue>(
    () => ({ active, setActive, clearActive, slotEl, registerSlot }),
    [active, setActive, clearActive, slotEl, registerSlot],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayerContext(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayerContext must be used within a PlayerProvider");
  }
  return ctx;
}
