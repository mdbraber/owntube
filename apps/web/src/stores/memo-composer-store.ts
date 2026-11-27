"use client";

import { create } from "zustand";

type MemoComposerState = {
  /** The video whose memo stack shows a new, empty card. */
  composingVideoId: string | null;
  open: (videoId: string) => void;
  close: () => void;
};

/**
 * Links the watch page's "Add memo" button (in the action row) to the memo
 * stack below it, which owns the new card.
 */
export const useMemoComposerStore = create<MemoComposerState>()((set) => ({
  composingVideoId: null,
  open: (videoId) => set({ composingVideoId: videoId }),
  close: () => set({ composingVideoId: null }),
}));
