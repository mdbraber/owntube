/** Approximate OS display scaling (1 = 100%, 2 = 200%). */
export function getOsDisplayScale(
  screenWidth: number,
  innerWidth: number,
): number {
  if (innerWidth <= 0) return 1;
  return screenWidth / innerWidth;
}

/** True when the OS scales the UI (HiDPI), so CSS viewport is much smaller than the panel. */
export function isOsDisplayScalingActive(
  screenWidth: number,
  innerWidth: number,
  devicePixelRatio: number,
): boolean {
  const osScale = getOsDisplayScale(screenWidth, innerWidth);
  if (osScale >= 1.5) return true;
  // Fallback: large physical width but small CSS viewport (e.g. 2160 panel @ 200%).
  const physicalApprox = innerWidth * devicePixelRatio;
  return innerWidth < 1400 && physicalApprox >= 2000;
}

/** Root `font-size` percent for rem-based UI (100 = browser default). */
export function getUiFontScalePercent(
  innerWidth: number,
  innerHeight: number,
  screenWidth: number,
  devicePixelRatio: number,
): number {
  if (isOsDisplayScalingActive(screenWidth, innerWidth, devicePixelRatio)) {
    return 100;
  }

  if (innerWidth >= 2400 && innerHeight >= 1200) return 125;
  if (innerWidth >= 1920 && innerHeight >= 1000) return 118;
  if (innerWidth >= 1600 && innerHeight >= 900) return 112;
  return 100;
}
