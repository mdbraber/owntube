import { buildMpd } from "@owntube/playback/dash";
import {
  buildMasterPlaylist,
  buildMediaPlaylist,
  buildSubtitlePlaylist,
} from "@owntube/playback/hls";
import type {
  Presentation,
  PresentationUrls,
  VideoFamily,
} from "@owntube/playback/tracks";
import { type Context, Hono } from "hono";
import {
  type PlaybackSession,
  type PlaybackSessions,
  Unavailable,
} from "./sessions.ts";
import { verifyPlayback } from "./signing.ts";
import { parseRange, streamSpan } from "./upstream.ts";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FAMILIES = new Set<VideoFamily>(["avc", "vp9", "av01"]);

function sessionUrls(sid: string): PresentationUrls {
  const base = `/media/s/${sid}`;
  return {
    media: (t) => `${base}/t/${t.id}`,
    mediaPlaylist: (t) => `${base}/p/${t.id}.m3u8`,
    caption: (c) => `${base}/c/${c.id}.vtt`,
    subtitlePlaylist: (c) => `${base}/c/${c.id}.m3u8`,
  };
}

/** What the client asked for: codec families it can decode and the tallest picture it wants. */
function selectTracks(presentation: Presentation, c: Context): Presentation {
  const families = (c.req.query("family") ?? "avc,vp9,av01")
    .split(",")
    .filter((f): f is VideoFamily => FAMILIES.has(f as VideoFamily));
  const maxHeight =
    Number(c.req.query("maxHeight")) || Number.POSITIVE_INFINITY;
  return {
    ...presentation,
    video: presentation.video.filter(
      (v) => families.includes(v.family) && v.height <= maxHeight,
    ),
  };
}

const STATUS_FOR: Record<Unavailable["unplayable"]["kind"], 403 | 404 | 409> = {
  "login-required": 403,
  "bot-check": 403,
  "age-restricted": 403,
  "members-only": 403,
  upcoming: 409,
  unavailable: 404,
  unplayable: 403,
};

export function mediaRoutes(
  sessions: PlaybackSessions,
  signingKey: string,
): Hono {
  const app = new Hono();

  /** Starts a playback session for a signed video URL and answers with its manifest. */
  async function start(
    c: Context,
    write: (s: PlaybackSession, p: Presentation) => string,
    type: string,
  ) {
    const videoId = c.req.param("videoId") ?? "";
    if (!VIDEO_ID.test(videoId)) return c.text("bad video id", 400);
    if (
      !verifyPlayback(
        signingKey,
        videoId,
        c.req.query("exp"),
        c.req.query("sig"),
      )
    )
      return c.text("bad signature", 403);
    let session: PlaybackSession;
    try {
      session = await sessions.create(videoId);
    } catch (error) {
      if (error instanceof Unavailable) {
        return c.json(
          { error: error.unplayable.kind, reason: error.unplayable.reason },
          STATUS_FOR[error.unplayable.kind],
        );
      }
      throw error;
    }
    const presentation = selectTracks(session.sources.presentation, c);
    if (presentation.video.length === 0 || presentation.audio.length === 0)
      return c.text("no playable tracks", 404);
    return c.body(write(session, presentation), 200, {
      "content-type": type,
      "cache-control": "no-store",
    });
  }

  app.get("/media/v/:videoId/manifest.mpd", (c) =>
    start(c, (s, p) => buildMpd(p, sessionUrls(s.id)), "application/dash+xml"),
  );
  app.get("/media/v/:videoId/master.m3u8", (c) =>
    start(
      c,
      (s, p) => buildMasterPlaylist(p, sessionUrls(s.id)),
      "application/vnd.apple.mpegurl",
    ),
  );

  // Everything below is reached only through a session id from a manifest.
  app.on(["GET", "HEAD"], "/media/s/:sid/t/:track", async (c) => {
    const session = sessions.get(c.req.param("sid"));
    const trackId = c.req.param("track");
    const track =
      session &&
      [
        ...session.sources.presentation.video,
        ...session.sources.presentation.audio,
      ].find((t) => t.id === trackId);
    if (!session || !track) return c.text("not found", 404);
    const span = parseRange(c.req.header("range"), track.contentLength);
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-type": track.mimeType,
      "cache-control": "private, max-age=3600",
    };
    if (!span)
      return c.body(null, 416, {
        ...headers,
        "content-range": `bytes */${track.contentLength}`,
      });
    const partial = c.req.header("range") !== undefined;
    headers["content-length"] = String(span.end - span.start + 1);
    if (partial)
      headers["content-range"] =
        `bytes ${span.start}-${span.end}/${track.contentLength}`;
    if (c.req.method === "HEAD")
      return c.body(null, partial ? 206 : 200, headers);
    const body = streamSpan(
      sessions.source(session, trackId),
      span,
      c.req.raw.signal,
    );
    return c.body(body, partial ? 206 : 200, headers);
  });

  app.get("/media/s/:sid/p/:file", async (c) => {
    const session = sessions.get(c.req.param("sid"));
    const trackId = c.req.param("file").replace(/\.m3u8$/, "");
    const track =
      session &&
      [
        ...session.sources.presentation.video,
        ...session.sources.presentation.audio,
      ].find((t) => t.id === trackId);
    if (!session || !track || track.mimeType.endsWith("webm"))
      return c.text("not found", 404);
    const segments = await sessions.segments(session, trackId);
    return c.body(
      buildMediaPlaylist(track, segments, sessionUrls(session.id)),
      200,
      {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "private, max-age=3600",
      },
    );
  });

  app.get("/media/s/:sid/c/:file", async (c) => {
    const session = sessions.get(c.req.param("sid"));
    const file = c.req.param("file");
    const id = file.replace(/\.(vtt|m3u8)$/, "");
    const caption = session?.sources.presentation.captions.find(
      (t) => t.id === id,
    );
    const url = session?.sources.captions.get(id);
    if (!session || !caption || !url) return c.text("not found", 404);
    if (file.endsWith(".m3u8")) {
      return c.body(
        buildSubtitlePlaylist(
          caption,
          session.sources.presentation.durationSec,
          sessionUrls(session.id),
        ),
        200,
        {
          "content-type": "application/vnd.apple.mpegurl",
        },
      );
    }
    const vttUrl = new URL(url);
    vttUrl.searchParams.set("fmt", "vtt");
    const upstream = await session.youtube.fetch(vttUrl, {
      headers: { "user-agent": session.userAgent },
      signal: c.req.raw.signal,
    });
    const text = await upstream.text();
    if (!upstream.ok || !text.startsWith("WEBVTT"))
      return c.text("captions unavailable", 502);
    return c.body(text, 200, {
      "content-type": "text/vtt; charset=utf-8",
      "cache-control": "private, max-age=3600",
    });
  });

  return app;
}
