import { buildMpd } from "@owntube/playback/dash";
import {
  buildMasterPlaylist,
  buildMediaPlaylist,
  buildSubtitlePlaylist,
} from "@owntube/playback/hls";
import { partsOf } from "@owntube/playback/mp4";
import type {
  AudioTrack,
  Presentation,
  PresentationUrls,
  VideoFamily,
  VideoTrack,
} from "@owntube/playback/tracks";
import { type Context, Hono } from "hono";
import {
  findTrack,
  type PlaybackSession,
  type PlaybackSessions,
  Unavailable,
} from "./sessions.ts";
import { verifyPlayback } from "./signing.ts";
import { parseRange, streamParts, streamSpan } from "./upstream.ts";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HLS = "application/vnd.apple.mpegurl";
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

/**
 * What the client asked for: codec families it can decode, the tallest
 * picture it wants, and (`lang`) one audio language instead of all of them.
 */
function selectTracks(presentation: Presentation, c: Context): Presentation {
  const lang = c.req.query("lang");
  const inLanguage = lang
    ? presentation.audio.filter((a) => a.language === lang)
    : [];
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
    // An unknown language keeps every track rather than none.
    audio: inLanguage.length > 0 ? inLanguage : presentation.audio,
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

function liveSegmentType(session: PlaybackSession, itag: string): string {
  return session.live?.renditions.get(itag)?.initUrl
    ? "video/mp4"
    : "video/mp2t";
}

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
    if (session.live) {
      // Live and DVR exist only as YouTube's HLS.
      if (type !== HLS) return c.json({ error: "live-is-hls" }, 406);
      return c.body(
        await sessions.liveMaster(session, `/media/s/${session.id}`),
        200,
        { "content-type": HLS, "cache-control": "no-store" },
      );
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
  /** Bytes of one track of a session, honouring a single `Range`. */
  function serveTrack(
    c: Context,
    session: PlaybackSession,
    track: VideoTrack | AudioTrack,
  ) {
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
      sessions.source(session, track.id),
      span,
      c.req.raw.signal,
    );
    return c.body(body, partial ? 206 : 200, headers);
  }

  // Everything below is reached only through a session id from a manifest.
  app.on(["GET", "HEAD"], "/media/s/:sid/t/:track", (c) => {
    const session = sessions.get(c.req.param("sid"));
    const trackId = c.req.param("track");
    const track = session && findTrack(session, trackId);
    if (!session || !track) return c.text("not found", 404);
    return serveTrack(c, session, track);
  });

  /**
   * A video's audio as one file, for RSS enclosures: the original language's
   * best AAC track (or `?lang=`). Repeated requests share one session.
   */
  app.on(["GET", "HEAD"], "/media/v/:videoId/audio.m4a", async (c) => {
    const videoId = c.req.param("videoId");
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
      session = await sessions.shared(videoId);
    } catch (error) {
      if (error instanceof Unavailable)
        return c.json(
          { error: error.unplayable.kind },
          STATUS_FOR[error.unplayable.kind],
        );
      throw error;
    }
    const lang = c.req.query("lang");
    const track = session.sources.presentation.audio
      .filter(
        (a) =>
          a.mimeType === "audio/mp4" &&
          (lang ? a.language === lang : a.isOriginal),
      )
      .sort((a, b) => b.bitrate - a.bitrate)[0];
    if (!track) return c.text("no audio", 404);
    return serveTrack(c, session, track);
  });

  /**
   * A video as one regular MP4 (H.264 up to `?height=`, default 720, with the
   * original language's AAC), for RSS enclosures: built from the byte-range
   * tracks without copying media, and seekable in every player.
   */
  app.on(["GET", "HEAD"], "/media/v/:videoId/video.mp4", async (c) => {
    const videoId = c.req.param("videoId");
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
      session = await sessions.shared(videoId);
    } catch (error) {
      if (error instanceof Unavailable)
        return c.json(
          { error: error.unplayable.kind },
          STATUS_FOR[error.unplayable.kind],
        );
      throw error;
    }
    const maxHeight = Number(c.req.query("height")) || 720;
    const { video, audio } = session.sources.presentation;
    const picture = video
      .filter(
        (t) =>
          t.family === "avc" &&
          t.mimeType === "video/mp4" &&
          t.height <= maxHeight,
      )
      .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)[0];
    const sound = audio
      .filter((t) => t.mimeType === "audio/mp4" && t.isOriginal)
      .sort((a, b) => b.bitrate - a.bitrate)[0];
    if (!picture || !sound) return c.text("no H.264 and AAC tracks", 404);
    const file = await sessions.progressiveFile(session, picture.id, sound.id);
    const span = parseRange(c.req.header("range"), file.size);
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-type": "video/mp4",
      "cache-control": "private, max-age=3600",
    };
    if (!span)
      return c.body(null, 416, {
        ...headers,
        "content-range": `bytes */${file.size}`,
      });
    const partial = c.req.header("range") !== undefined;
    headers["content-length"] = String(span.end - span.start + 1);
    if (partial)
      headers["content-range"] = `bytes ${span.start}-${span.end}/${file.size}`;
    if (c.req.method === "HEAD")
      return c.body(null, partial ? 206 : 200, headers);
    const parts = partsOf(file, span).map((p) =>
      "bytes" in p
        ? p
        : { source: sessions.source(session, p.source), span: p.range },
    );
    return c.body(
      streamParts(parts, c.req.raw.signal),
      partial ? 206 : 200,
      headers,
    );
  });

  app.get("/media/s/:sid/p/:file", async (c) => {
    const session = sessions.get(c.req.param("sid"));
    const trackId = c.req.param("file").replace(/\.m3u8$/, "");
    const track = session && findTrack(session, trackId);
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

  app.get("/media/s/:sid/l/:file", async (c) => {
    const session = sessions.get(c.req.param("sid"));
    const itag = c.req.param("file").replace(/\.m3u8$/, "");
    if (!session?.live) return c.text("not found", 404);
    const playlist = await sessions.liveMedia(
      session,
      itag,
      `/media/s/${session.id}`,
    );
    if (playlist === null) return c.text("not found", 404);
    return c.body(playlist, 200, {
      "content-type": HLS,
      "cache-control": "no-store",
    });
  });

  app.get("/media/s/:sid/l/:itag/:segment", async (c) => {
    const session = sessions.get(c.req.param("sid"));
    if (!session?.live) return c.text("not found", 404);
    const upstream = await sessions.liveSegment(
      session,
      c.req.param("itag"),
      c.req.param("segment"),
      c.req.raw.signal,
    );
    if (!upstream) return c.text("not found", 404);
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      return c.text("segment unavailable", 502);
    }
    const headers: Record<string, string> = {
      // YouTube labels TS segments application/octet-stream; Apple players expect video/mp2t.
      "content-type":
        c.req.param("segment") === "init"
          ? "video/mp4"
          : liveSegmentType(session, c.req.param("itag")),
      "cache-control": "private, max-age=3600",
    };
    const length = upstream.headers.get("content-length");
    if (length) headers["content-length"] = length;
    return c.body(upstream.body, 200, headers);
  });

  /** One caption track as WebVTT, fetched in the session that listed it. */
  async function serveVtt(
    c: Context,
    session: PlaybackSession,
    id: string,
  ): Promise<Response> {
    const url = session.sources.captions.get(id);
    if (!url) return c.text("not found", 404);
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
  }

  /**
   * A caption track for a `<track>` element (players that draw their own
   * subtitles): `?lang=`, YouTube's automatic one with `auto=1`.
   */
  app.get("/media/v/:videoId/captions.vtt", async (c) => {
    const videoId = c.req.param("videoId");
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
    const lang = c.req.query("lang");
    const auto = c.req.query("auto") === "1";
    let session: PlaybackSession;
    try {
      session = await sessions.shared(videoId);
    } catch (error) {
      if (error instanceof Unavailable)
        return c.json(
          { error: error.unplayable.kind },
          STATUS_FOR[error.unplayable.kind],
        );
      throw error;
    }
    const track = session.sources.presentation.captions.find(
      (t) => t.language === lang && t.autoGenerated === auto,
    );
    if (!track) return c.text("no such captions", 404);
    return serveVtt(c, session, track.id);
  });

  app.get("/media/s/:sid/c/:file", async (c) => {
    const session = sessions.get(c.req.param("sid"));
    const file = c.req.param("file");
    const id = file.replace(/\.(vtt|m3u8)$/, "");
    const caption = session?.sources.presentation.captions.find(
      (t) => t.id === id,
    );
    if (!session || !caption) return c.text("not found", 404);
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
    return serveVtt(c, session, id);
  });

  return app;
}
