"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
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
  // Cinema mode is a widescreen/desktop feature — it must never apply on phones
  // (where the player is already full-width). Gate it on the `sm` breakpoint so
  // a `defaultCinemaMode` preference doesn't leak into the mobile layout.
  const [isWide, setIsWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const effectiveCinema = cinemaMode && isWide;
  const value = useMemo(
    () => ({ cinemaMode: effectiveCinema, setCinemaMode }),
    [effectiveCinema],
  );
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
