"use client";

import { useEffect, useState } from "react";
import {
  averageLargeVideoColumnWidthPx,
  countGridTemplateColumns,
  parseFirstGridColumnWidthPx,
} from "@/lib/video-grid-columns";

const DEFAULT_COLUMN_COUNT = 4;
const DEFAULT_COLUMN_WIDTH_PX = 280;
const DEFAULT_CONTAINER_WIDTH_PX = 4 * 280 + 3 * 28;

type LargeVideoGridMetrics = {
  /** Attach to a `.ot-video-grid--large` element to measure its real columns. */
  measureRef: (element: HTMLElement | null) => void;
  columnCount: number;
  columnWidthPx: number;
  containerWidthPx: number;
};

/**
 * Column count and average track width for `.ot-video-grid--large`, from the
 * resolved grid layout (ResizeObserver + getComputedStyle).
 */
export function useLargeVideoGridColumnCount(): LargeVideoGridMetrics {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [columnCount, setColumnCount] = useState(DEFAULT_COLUMN_COUNT);
  const [columnWidthPx, setColumnWidthPx] = useState(DEFAULT_COLUMN_WIDTH_PX);
  const [containerWidthPx, setContainerWidthPx] = useState(
    DEFAULT_CONTAINER_WIDTH_PX,
  );

  useEffect(() => {
    if (!element) return;

    const update = () => {
      const containerWidthPx = element.getBoundingClientRect().width;
      const template = getComputedStyle(element).gridTemplateColumns;
      const cols = countGridTemplateColumns(template);
      const fromTemplate = parseFirstGridColumnWidthPx(template);
      const colW =
        fromTemplate ?? averageLargeVideoColumnWidthPx(containerWidthPx, cols);
      setColumnCount(cols);
      setColumnWidthPx(colW);
      setContainerWidthPx(containerWidthPx);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return {
    measureRef: setElement,
    columnCount,
    columnWidthPx,
    containerWidthPx,
  };
}
