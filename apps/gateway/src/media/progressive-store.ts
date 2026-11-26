import type { ProgressiveFile } from "@owntube/playback/mp4";
import cacache from "cacache";
import type { ProgressiveStore } from "./sessions.ts";

/**
 * Built progressive-MP4 layouts on disk. Building one reads every fragment
 * header of two tracks (seconds of requests); the result depends only on the
 * files, so it is kept across sessions and restarts.
 */
export function diskProgressiveStore(dir: string): ProgressiveStore {
  return {
    async get(key) {
      const entry = await cacache.get(dir, key).catch(() => undefined);
      if (!entry) return undefined;
      const { size, header, chunks } = JSON.parse(
        entry.data.toString("utf8"),
      ) as {
        size: number;
        header: string;
        chunks: ProgressiveFile["chunks"];
      };
      return {
        size,
        header: new Uint8Array(Buffer.from(header, "base64")),
        chunks,
      };
    },
    async put(key, file) {
      const data = JSON.stringify({
        size: file.size,
        header: Buffer.from(file.header).toString("base64"),
        chunks: file.chunks,
      });
      await cacache.put(dir, key, data);
    },
  };
}
