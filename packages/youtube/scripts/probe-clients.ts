/**
 * Which client gives what, without a PO token, from this host right now.
 *
 *   pnpm --filter @owntube/youtube probe:clients
 *
 * For each corpus video and each client identity: playability, stream URLs,
 * the highest height, dubbed audio tracks, whether the first bytes of the best
 * video and audio stream actually download, captions (listed, and fetched as
 * VTT), and SABR / live manifest availability. Prints a Markdown table.
 */
import { Log } from "youtubei.js";
import { CLIENTS, type ClientIdentity } from "../src/clients.ts";
import { createEgress } from "../src/egress.ts";
import { createCorpusContext } from "../src/fixtures/context.ts";
import { CORPUS } from "../src/fixtures/corpus.ts";
import type { PlayerResult } from "../src/player.ts";
import { SessionPool } from "../src/session.ts";
import { YouTube } from "../src/youtube.ts";

Log.setLevel(Log.Level.ERROR);

const FIXED: Array<[string, string]> = [
  ["ordinary", "dQw4w9WgXcQ"],
  ["2160p", "aqz-KE-bpKQ"],
  ["dubbed", "0e3GPea1Tyg"],
  ["age-restricted", "HtVdAasjOgU"],
];
const DISCOVERED = ["video-short", "video-live", "video-post-live-dvr"];

async function subjects(): Promise<Array<[string, string]>> {
  const out = [...FIXED];
  for (const id of DISCOVERED) {
    const entry = CORPUS.find((e) => e.id === id);
    if (!entry?.discover) continue;
    try {
      out.push([
        id.replace("video-", ""),
        await entry.discover((await createCorpusContext(fetch, undefined)).ctx),
      ]);
    } catch (error) {
      process.stderr.write(`${id}: ${(error as Error).message}\n`);
    }
  }
  return out;
}

async function firstBytes(
  url: string,
  identity: ClientIdentity,
): Promise<string> {
  try {
    const res = await fetch(
      `${url}${url.includes("?") ? "&" : "?"}range=0-1023`,
      {
        headers: { "user-agent": identity.userAgent },
      },
    );
    const bytes = (await res.arrayBuffer()).byteLength;
    return res.ok && bytes > 0 ? "ok" : `${res.status}/${bytes}B`;
  } catch (error) {
    return `err ${(error as Error).message.slice(0, 30)}`;
  }
}

async function captions(
  result: PlayerResult,
  identity: ClientIdentity,
): Promise<string> {
  const tracks =
    result.raw.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) return "–";
  const track = tracks[0];
  if (!track) return "–";
  try {
    // Some clients list caption URLs relative to www.youtube.com.
    const url = new URL(track.baseUrl, "https://www.youtube.com");
    url.searchParams.set("fmt", "vtt");
    const res = await fetch(url, {
      headers: { "user-agent": identity.userAgent },
    });
    const text = await res.text();
    return `${tracks.length} (${text.startsWith("WEBVTT") ? "vtt ok" : `${res.status}/${text.length}B`})`;
  } catch (error) {
    return `${tracks.length} (err ${(error as Error).message.slice(0, 30)})`;
  }
}

async function row(
  label: string,
  videoId: string,
  identity: ClientIdentity,
): Promise<string> {
  let result: PlayerResult;
  try {
    result = await youtube.player(videoId, identity);
  } catch (error) {
    return `| ${label} | ${identity.name} | error: ${(error as Error).message.slice(0, 60)} |||||||`;
  }
  const status = result.unplayable ? result.unplayable.kind : "OK";
  const video = result.formats
    .filter((f) => f.width)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const audio = result.formats.filter(
    (f) => !f.width && f.mimeType.startsWith("audio/"),
  );
  const tracks = new Set(audio.map((f) => f.audioTrack?.id).filter(Boolean))
    .size;
  const codecs = [
    ...new Set(
      video.map((f) => /avc1|vp0?9|av01/.exec(f.mimeType)?.[0]).filter(Boolean),
    ),
  ].join("/");
  const sd = result.raw.streamingData;
  const live = [
    sd?.hlsManifestUrl ? "hls" : "",
    sd?.dashManifestUrl ? "dash" : "",
  ]
    .filter(Boolean)
    .join("+");
  const sabr = sd?.serverAbrStreamingUrl ? "yes" : "–";
  const media =
    video[0] && audio[0]
      ? `${await firstBytes(video[0].url, identity)} / ${await firstBytes(audio[0].url, identity)}`
      : "–";
  return `| ${label} | ${identity.name} | ${status} | ${result.formats.length} | ${video[0]?.height ?? "–"} ${codecs} | ${tracks || "–"} | ${media} | ${await captions(result, identity)} | ${sabr} | ${live || "–"} |`;
}

// The production path: egress, session pool and the YouTube facade.
const egress = createEgress();
const pool = new SessionPool({ egress });
const youtube = new YouTube(pool);
const player = await pool.player();
const lines = [
  `Probe ${new Date().toISOString()}, player ${player.player_id}, no PO token.`,
  "",
  "| video | client | playable | URLs | best video | dub tracks | media video/audio | captions | SABR | live manifests |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
for (const [label, videoId] of await subjects()) {
  for (const identity of Object.values(CLIENTS))
    lines.push(await row(`${label} \`${videoId}\``, videoId, identity));
}
process.stdout.write(`${lines.join("\n")}\n`);
await egress.close();
