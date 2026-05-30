import { createHash } from "node:crypto";
import { SPONSORBLOCK_HASH_PREFIX_LENGTH } from "@/lib/sponsorblock";

export function sha256VideoIdHex(videoId: string): string {
  return createHash("sha256").update(videoId).digest("hex");
}

export function hashPrefixForVideoId(
  videoId: string,
  prefixLength = SPONSORBLOCK_HASH_PREFIX_LENGTH,
): string {
  return sha256VideoIdHex(videoId).slice(0, prefixLength);
}
