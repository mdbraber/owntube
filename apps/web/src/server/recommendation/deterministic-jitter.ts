/** FNV-1a 32-bit hash mapped to [0, 1) — stable pseudo-random ordering without Math.random(). */
export function deterministicUnitInterval(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

/** Symmetric ±0.04 jitter used to vary cold-start ordering per user without flicker. */
export function deterministicColdStartJitter(
  userId: number,
  videoId: string,
): number {
  const u = deterministicUnitInterval(`${userId}:${videoId}`);
  return (u - 0.5) * 0.08;
}

/**
 * Seed for the deterministic explore bonus: stable for a user within a day so
 * pool rebuilds keep their ordering, rotates daily so exploration is not frozen.
 */
export function dailyExploreSeed(userId: number, nowSec: number): string {
  return `${userId}:${Math.floor(nowSec / 86400)}`;
}
