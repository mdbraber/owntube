import { describe, expect, it } from "vitest";
import { cardPreviewPlaybackFromDetail } from "@/lib/card-preview-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

function base(over: Partial<VideoDetail>): VideoDetail {
  return {
    videoId: "abcdefghijk",
    title: "t",
    audioSources: [],
    videoSources: [],
    sourceUsed: "piped",
    mediaProxyBase: "http://192.168.1.11:8092",
    ...over,
  };
}

describe("cardPreviewPlaybackFromDetail", () => {
  it("prefers muxed 360p from raw sources even when watch drops it for split", () => {
    const detail = base({
      videoSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=18",
          quality: "360p",
          videoOnly: false,
          mimeType: "video/mp4",
          height: 360,
        },
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=137",
          quality: "1080p",
          videoOnly: true,
          mimeType: 'video/mp4; codecs="avc1.640028"',
          height: 1080,
        },
      ],
      audioSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=140",
          quality: "medium",
          mimeType: "audio/mp4",
        },
      ],
    });
    const playback = cardPreviewPlaybackFromDetail(
      detail,
      "http://192.168.1.14:3000",
      "192.168.1.14:3000",
    );
    expect(playback?.kind).toBe("muxed");
    if (playback?.kind === "muxed") {
      expect(playback.src).toContain("192.168.1.11:8092");
      expect(playback.src).toContain("itag=18");
    }
  });

  it("accepts muxed rows without parseable height when quality is not HD", () => {
    const detail = base({
      videoSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=18",
          quality: "LBRY",
          videoOnly: false,
          mimeType: "video/mp4",
          height: 0,
        },
      ],
    });
    const playback = cardPreviewPlaybackFromDetail(
      detail,
      "http://192.168.1.14:3000",
      "192.168.1.14:3000",
    );
    expect(playback?.kind).toBe("muxed");
  });

  it("uses silent video-only when no muxed preview exists", () => {
    const detail = base({
      videoSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=133",
          quality: "240p",
          videoOnly: true,
          mimeType: 'video/mp4; codecs="avc1.4d4015"',
          height: 240,
        },
      ],
      audioSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=140",
          quality: "medium",
          mimeType: "audio/mp4",
        },
      ],
    });
    const playback = cardPreviewPlaybackFromDetail(
      detail,
      "http://192.168.1.14:3000",
      "192.168.1.14:3000",
    );
    expect(playback?.kind).toBe("muxed");
    if (playback?.kind === "muxed") {
      expect(playback.src).toContain("itag=133");
    }
  });

  it("falls back to split when no single-url preview exists", () => {
    const detail = base({
      videoSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=137",
          quality: "1080p",
          videoOnly: true,
          mimeType: 'video/mp4; codecs="avc1.640028"',
          height: 1080,
        },
      ],
      audioSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=140",
          quality: "medium",
          mimeType: "audio/mp4",
        },
      ],
    });
    const playback = cardPreviewPlaybackFromDetail(
      detail,
      "http://192.168.1.14:3000",
      "192.168.1.14:3000",
    );
    expect(playback?.kind).toBe("split");
  });

  // In the browser INVIDIOUS_BASE_URL is never defined (server-only env), so
  // raw googlevideo rows resolve to the `/yt-hls` hop — mirror that here.
  const withoutInvidiousProxy = <T>(fn: () => T): T => {
    const prev = process.env.INVIDIOUS_BASE_URL;
    delete process.env.INVIDIOUS_BASE_URL;
    try {
      return fn();
    } finally {
      if (prev !== undefined) process.env.INVIDIOUS_BASE_URL = prev;
    }
  };

  it("prefers synthesized HLS over a raw-googlevideo muxed row (yt-hls hop 403s)", () => {
    const detail = base({
      sourceUsed: "invidious",
      videoSources: [
        {
          url: "https://rr2---sn-abc.googlevideo.com/videoplayback?itag=18",
          quality: "360p",
          videoOnly: false,
          mimeType: "video/mp4",
          height: 360,
        },
        {
          // adaptive video-only row → buildWatchPlayback synthesizes /hls
          url: "https://rr2---sn-abc.googlevideo.com/videoplayback?itag=137",
          quality: "1080p",
          videoOnly: true,
          mimeType: 'video/mp4; codecs="avc1.640028"',
          height: 1080,
        },
      ],
      audioSources: [
        {
          url: "https://rr2---sn-abc.googlevideo.com/videoplayback?itag=140",
          quality: "medium",
          mimeType: "audio/mp4",
        },
      ],
    });
    const playback = withoutInvidiousProxy(() =>
      cardPreviewPlaybackFromDetail(
        detail,
        "http://192.168.1.14:3000",
        "192.168.1.14:3000",
      ),
    );
    expect(playback).toEqual({
      kind: "hls",
      src: "http://192.168.1.14:3000/hls/abcdefghijk/master.m3u8",
    });
  });

  it("keeps the yt-hls muxed hop as last resort when no other route exists", () => {
    const detail = base({
      sourceUsed: "invidious",
      videoSources: [
        {
          url: "https://rr2---sn-abc.googlevideo.com/videoplayback?itag=18",
          quality: "360p",
          videoOnly: false,
          mimeType: "video/mp4",
          height: 360,
        },
      ],
    });
    const playback = withoutInvidiousProxy(() =>
      cardPreviewPlaybackFromDetail(
        detail,
        "http://192.168.1.14:3000",
        "192.168.1.14:3000",
      ),
    );
    expect(playback?.kind).toBe("muxed");
    if (playback?.kind === "muxed") {
      expect(playback.src).toContain("/yt-hls?url=");
      expect(playback.src).toContain("itag%3D18");
    }
  });
});
