import { useEffect, useState } from "react";

/**
 * Columns an auto-fill grid would resolve at the container's width — same
 * formula as CSS `repeat(auto-fill, minmax(min(100%, minPx), 1fr))`.
 * Measured on the block wrapper (which always exists), so it also works when
 * the narrow-screen fallback renders rows instead of the grid.
 */
export function useAutoFillColumns(minWidthPx: number, gapPx = 28) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      const w = element.getBoundingClientRect().width;
      setColumns(Math.max(1, Math.floor((w + gapPx) / (minWidthPx + gapPx))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, minWidthPx, gapPx]);
  return { ref: setElement, columns };
}
