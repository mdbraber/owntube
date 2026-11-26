import { Innertube } from "youtubei.js";
import type { CorpusContext } from "./corpus.ts";
import type { Exchange } from "./exchange.ts";
import { createRecordingFetch } from "./recording-fetch.ts";

/**
 * The context a corpus entry runs in, the same for recording (`inner` is the
 * network) and for replay (`inner` answers from a fixture). `exchanges` is
 * everything the entry caused, unscrubbed.
 */
export async function createCorpusContext(
  inner: typeof fetch,
  subjectId: string | undefined,
): Promise<{ ctx: CorpusContext; exchanges: Exchange[] }> {
  const recording = createRecordingFetch(inner);
  const yt = await Innertube.create({
    fetch: recording.fetch,
    lang: "en",
    retrieve_player: false,
    enable_session_cache: false,
  });
  const raw: CorpusContext["raw"] = async (fn) => {
    const from = recording.exchanges.length;
    await fn();
    return recording.exchanges.slice(from).map((e) => e.responseBody);
  };
  return { ctx: { yt, subjectId, raw }, exchanges: recording.exchanges };
}
