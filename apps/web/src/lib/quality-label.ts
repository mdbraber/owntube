/**
 * The quality name for a video frame size, as YouTube names it: by the 16:9
 * box the frame fills, not its raw height. A 2:1 video at 1920×960 is
 * "1080p" (full-HD width), a 2.39:1 film at 1920×804 too, and a vertical
 * 1080×1920 short is "1080p" as well (its short side).
 */
const LADDER = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];

export function qualityLabelHeight(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return Math.max(0, Math.round(height));
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const equivalent = Math.max(short, (long * 9) / 16);
  // Snap to the standard rung it rounds to (encoders trim a few pixels:
  // 426×240 is "240p", 854×428 "480p").
  for (const rung of LADDER) {
    if (equivalent <= rung * 1.04) return rung;
  }
  return Math.round(equivalent);
}

export function qualityLabel(width: number, height: number): string {
  const h = qualityLabelHeight(width, height);
  return h > 0 ? `${h}p` : "?";
}
