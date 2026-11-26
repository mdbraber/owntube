/**
 * Do byte-range stream URLs keep working through a whole playback? Downloads
 * one stream per client at playback pace (one chunk every few seconds) and
 * reports the first failure. YouTube has revoked some clients' URLs about a
 * minute in, so this is the measurement behind the VOD transport choice.
 *
 *   pnpm --filter @owntube/youtube probe:sustained [videoId] [minutes] [CLIENT,CLIENT]
 */
import { Innertube, Log } from "youtubei.js";
import { CLIENTS, type ClientIdentity } from "../src/clients.ts";
import { loadPlayer } from "../src/decipher.ts";
import { requestPlayer } from "../src/player.ts";

Log.setLevel(Log.Level.ERROR);
const videoId = process.argv[2] ?? "aqz-KE-bpKQ";
const minutes = Number(process.argv[3] ?? 5);
const CHUNK = 1 << 20;
const INTERVAL_MS = 3_000;

const yt = await Innertube.create({
  retrieve_player: false,
  enable_session_cache: false,
});
const visitorData = yt.session.context.client.visitorData ?? "";
const player = await loadPlayer(fetch);

async function run(identity: ClientIdentity): Promise<string> {
  const result = await requestPlayer(
    {
      videoId,
      identity,
      visitorData,
      player: identity.deciphers ? player : undefined,
    },
    fetch,
  );
  const stream = result.formats
    .filter(
      (f) =>
        f.height === 1080 && f.mimeType.includes("avc1") && f.contentLength,
    )
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  if (!stream) return `${identity.name}: no 1080p H.264 stream`;
  const size = Number(stream.contentLength);
  const started = Date.now();
  let offset = 0;
  let chunks = 0;
  while (Date.now() - started < minutes * 60_000 && offset < size) {
    const end = Math.min(offset + CHUNK, size) - 1;
    const res = await fetch(`${stream.url}&range=${offset}-${end}`, {
      headers: { "user-agent": identity.userAgent },
    });
    const bytes = (await res.arrayBuffer()).byteLength;
    if (!res.ok || bytes !== end - offset + 1) {
      return `${identity.name}: FAILED after ${((Date.now() - started) / 1000).toFixed(0)} s, ${chunks} chunks (${(offset / CHUNK).toFixed(0)} MB): HTTP ${res.status}, ${bytes} B`;
    }
    offset = end + 1;
    chunks++;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  return `${identity.name}: ok for ${((Date.now() - started) / 1000).toFixed(0)} s, ${chunks} chunks, ${(offset / CHUNK).toFixed(0)} of ${(size / CHUNK).toFixed(0)} MB, itag ${stream.itag}`;
}

const identities = (process.argv[4] ?? "VISIONOS,TV_SIMPLY,ANDROID_VR")
  .split(",")
  .map((name) => CLIENTS[name as keyof typeof CLIENTS])
  .filter((c): c is ClientIdentity => Boolean(c));
const results = await Promise.all(
  identities.map((c) =>
    run(c).catch((e: Error) => `${c.name}: error ${e.message}`),
  ),
);
process.stdout.write(
  `${new Date().toISOString()} ${videoId}, ${minutes} min, 1 MB every ${INTERVAL_MS / 1000} s\n${results.join("\n")}\n`,
);
