/**
 * Does a minted PO token work? WEB gives no usable stream URLs without one;
 * with a valid content token (bound to the video id) the player answers with
 * URLs, and with a valid session token (bound to visitor data) in `pot=` they
 * download. Mints with the browser minter and checks both, per video.
 *
 *   PO_BROWSER=/path/to/chrome pnpm --filter @owntube/youtube probe:potoken [videoId...]
 */
import { Log } from "youtubei.js";
import { CLIENTS } from "../src/clients.ts";
import { createEgress } from "../src/egress.ts";
import { requestPlayer } from "../src/player.ts";
import { BrowserPoTokenMinter } from "../src/potoken.ts";
import { SessionPool } from "../src/session.ts";

Log.setLevel(Log.Level.ERROR);
const executablePath = process.env.PO_BROWSER;
if (!executablePath) throw new Error("set PO_BROWSER to a Chromium executable");
const videos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["dQw4w9WgXcQ", "aqz-KE-bpKQ", "0e3GPea1Tyg"];

const egress = createEgress();
const pool = new SessionPool({ egress });
const session = await pool.session();
const player = await pool.player();
const client =
  CLIENTS[(process.env.PO_CLIENT ?? "MWEB") as keyof typeof CLIENTS];
const minter = new BrowserPoTokenMinter({
  executablePath,
  fetch: session.fetch,
  userAgent: client.userAgent,
});
console.log("client", client.name);

let t0 = Date.now();
const sessionToken = await minter.mint(session.visitorData);
console.log(
  `first mint (browser start, BotGuard, integrity token): ${Date.now() - t0} ms, token ${sessionToken.length} chars`,
);
for (const videoId of videos) {
  t0 = Date.now();
  const contentToken = await minter.mint(videoId);
  const mintMs = Date.now() - t0;
  const withToken = await requestPlayer(
    {
      videoId,
      identity: client,
      visitorData: session.visitorData,
      player,
      poToken: contentToken,
    },
    session.fetch,
  );
  const without = await requestPlayer(
    { videoId, identity: client, visitorData: session.visitorData, player },
    session.fetch,
  );
  const adaptive = withToken.formats.filter((f) => f.initRange);
  const probe =
    adaptive.find((f) => f.mimeType.startsWith("audio/")) ?? adaptive[0];
  let download = "no URL to try";
  if (probe) {
    const res = await session.fetch(
      `${probe.url}&pot=${encodeURIComponent(sessionToken)}&range=0-1`,
      { headers: { "user-agent": client.userAgent } },
    );
    download = `${res.status} ${(await res.arrayBuffer()).byteLength} B`;
  }
  console.log(
    `${videoId}: mint ${mintMs} ms; adaptive URLs without token ${without.formats.filter((f) => f.initRange).length}, with token ${adaptive.length} (${withToken.unplayable?.kind ?? "OK"}); 2-byte download with pot: ${download}`,
  );
}
await minter.close();
await egress.close();
