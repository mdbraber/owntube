"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type WatchCinemaValue = {
  cinemaMode: boolean;
  setCinemaMode: Dispatch<SetStateAction<boolean>>;
};

const WatchCinemaContext = createContext<WatchCinemaValue | null>(null);

export function WatchCinemaProvider({
  children,
  initialCinemaMode = false,
}: {
  children: ReactNode;
  initialCinemaMode?: boolean;
}) {
  const [cinemaMode, setCinemaMode] = useState(initialCinemaMode);
  const value = useMemo(() => ({ cinemaMode, setCinemaMode }), [cinemaMode]);
  return (
    <WatchCinemaContext.Provider value={value}>
      {children}
    </WatchCinemaContext.Provider>
  );
}

/** Present on the watch page only; `null` elsewhere. */
export function useWatchCinema(): WatchCinemaValue | null {
  return useContext(WatchCinemaContext);
}
