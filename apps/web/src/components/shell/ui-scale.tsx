"use client";

import { useEffect } from "react";
import { getUiFontScalePercent } from "@/lib/ui-display-scale";

export function UiScale() {
  useEffect(() => {
    function applyScale() {
      const scale = getUiFontScalePercent(
        window.innerWidth,
        window.innerHeight,
        window.screen.width,
        window.devicePixelRatio,
      );
      document.documentElement.style.fontSize = `${scale}%`;
    }

    applyScale();
    window.addEventListener("resize", applyScale);
    return () => window.removeEventListener("resize", applyScale);
  }, []);

  return null;
}
