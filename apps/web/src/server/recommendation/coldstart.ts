/** Few watches → blend more exploration (see engine). */
export function useColdStartBlend(totalWatches: number): boolean {
  return totalWatches < 10;
}
