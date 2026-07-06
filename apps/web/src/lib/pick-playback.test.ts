import { describe, expect, it } from "vitest";
import {
  buildWatchPlayback,
  pickPlaybackForVidstack,
} from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

function base(over: Partial<VideoDetail>): VideoDetail {
  return {
    videoId: "x",
    title: "t",
    audioSources: [],
    videoSources: [],
    sourceUsed: "invidious",
    ...over,
  };
}

describe("buildWatchPlayback", () => {
  it("forces HLS for live streams even when progressive exists", () => {
    const w = buildWatchPlayback(
      base({
        isLive: true,
        hlsUrl: "https://h.example/live.m3u8",
        videoSources: [{ url: "https://g.example/360.mp4", quality: "360p" }],
      }),
    );
    expect(w).toEqual({
      kind: "hls",
      url: "https://h.example/live.m3u8",
      onlyDashOrUnsupported: false,
    });
  });

  it("uses HLS when present", () => {
    const w = buildWatchPlayback(
      base({
        hlsUrl: "https://h.example/playlist.m3u8",
        videoSources: [{ url: "https://g.example/360.mp4", quality: "360p" }],
      }),
    );
    expect(w).toEqual({
      kind: "hls",
      url: "https://h.example/playlist.m3u8",
      onlyDashOrUnsupported: false,
    });
  });

  it("routes multi-language Invidious adaptive video to the generated HLS manifest", () => {
    const w = buildWatchPlayback(
      base({
        hlsUrl: "https://h.example/playlist.m3u8",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud-en.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
          {
            url: "https://g.example/aud-fr.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "fr",
            audioTrackDisplayName: "French",
          },
        ],
      }),
    );
    expect(w).toEqual({
      kind: "hls",
      url: "/hls/x/master.m3u8",
      onlyDashOrUnsupported: false,
    });
  });

  it("infers ≥2 audio languages from xtags and keeps the Piped split picker", () => {
    const w = buildWatchPlayback(
      base({
        // Multi-language Piped keeps the split (language picker) even with an
        // HLS URL; Invidious adaptive would instead route to generated HLS.
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        hlsUrl: "https://h.example/playlist.m3u8",
        videoSources: [
          {
            url: "https://g.example/720v.mp4",
            quality: "720p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/playback?xtags=acont%3Doriginal%3Alang%3Den-US&itag=140",
            quality: "medium",
            mimeType: "audio/mp4",
          },
          {
            url: "https://g.example/playback?xtags=acont%3Ddubbed%3Alang%3Des-419&itag=140",
            quality: "medium",
            mimeType: "audio/mp4",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive" && w.variants[0]?.t === "split") {
      expect(w.variants[0].audioOptions).toHaveLength(2);
      const enOpt = w.variants[0].audioOptions.find((o) =>
        o.url.includes("lang%3Den"),
      );
      expect(enOpt?.label.toLowerCase()).toMatch(/original/);
      expect(w.variants[0].defaultAudioIndex).toBe(0);
    }
  });

  it("defaults to original audio even when it is not the first adaptive row", () => {
    const w = buildWatchPlayback(
      base({
        // Split construction is Piped-only now; Invidious adaptive routes to
        // the generated HLS manifest (see the routing tests above).
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/playback?xtags=lang%3Dfr&itag=140",
            quality: "medium",
            mimeType: "audio/mp4",
          },
          {
            url: "https://g.example/playback?xtags=acont%3Doriginal%3Alang%3Den&itag=140",
            quality: "medium",
            mimeType: "audio/mp4",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive" && w.variants[0]?.t === "split") {
      expect(w.variants[0].audioUrl).toContain("lang%3Den");
      expect(w.variants[0].defaultAudioIndex).toBe(1);
    }
  });

  it("keeps HLS when only one audio language is detected", () => {
    const w = buildWatchPlayback(
      base({
        hlsUrl: "https://h.example/playlist.m3u8",
        videoSources: [
          {
            url: "https://g.example/720v.mp4",
            quality: "720p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("hls");
  });

  it("uses progressive list sorted with best first (muxed)", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          { url: "https://g.example/360.mp4", quality: "360p" },
          { url: "https://g.example/1080.mp4", quality: "1080p" },
          { url: "https://g.example/720.mp4", quality: "720p" },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants.map((v) => v.t)).toEqual(["muxed", "muxed", "muxed"]);
      expect(w.variants.map((v) => v.label)).toEqual(["1080p", "720p", "360p"]);
    }
  });

  it("drops muxed rows with audio MIME when a real video split exists", () => {
    const w = buildWatchPlayback(
      base({
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/bad-audio.m4a",
            quality: "360p",
            videoOnly: false,
            mimeType: "audio/mp4",
          },
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("split");
    }
  });

  it("keeps height=0 legacy muxed (Piped itag 18) alongside other muxed rows", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/bad.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
            height: 0,
          },
          {
            url: "https://g.example/good.mp4",
            quality: "720p",
            videoOnly: false,
            mimeType: "video/mp4",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(
        w.variants.map((v) => (v.t === "muxed" ? v.url : v.videoUrl)),
      ).toEqual(["https://g.example/good.mp4", "https://g.example/bad.mp4"]);
    }
  });

  it("drops video/* rows whose codecs are audio-only when a normal muxed exists", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/fake.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: 'video/mp4; codecs="mp4a.40.2"',
          },
          {
            url: "https://g.example/ok.mp4",
            quality: "720p",
            videoOnly: false,
            mimeType: "video/mp4",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("muxed");
      if (w.variants[0]?.t === "muxed") {
        expect(w.variants[0].url).toBe("https://g.example/ok.mp4");
      }
    }
  });

  it("falls back to unfiltered list if every stream would be dropped", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/only-bad.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: 'video/mp4; codecs="mp4a.40.2"',
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("muxed");
    }
  });

  it("uses short quality-only labels for muxed rows (no bitrate in menu)", () => {
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/720.mp4",
            quality: "720p",
            bitrate: 2_800_000,
            fps: 30,
          },
          { url: "https://g.example/360.mp4", quality: "360p" },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants.map((v) => v.label)).toEqual(["720p", "360p"]);
    }
  });

  it("routes DASH-only Invidious video to the generated HLS manifest", () => {
    // dashUrl signals adaptive streams exist; generate.ts re-fetches its own
    // AVC/AAC streams, so we route to the synthesized manifest rather than none.
    const w = buildWatchPlayback(
      base({
        dashUrl: "https://d.example/playlist",
        videoSources: [],
      }),
    );
    expect(w).toEqual({
      kind: "hls",
      url: "/hls/x/master.m3u8",
      onlyDashOrUnsupported: false,
    });
  });

  it("uses quality-only split row label; audio submenu shows language name without bitrate noise", () => {
    const w = buildWatchPlayback(
      base({
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 8_000_000,
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
            bitrate: 128_000,
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants[0]?.label).toBe("1080p");
      if (w.variants[0]?.t === "split") {
        const al = w.variants[0].audioOptions[0]?.label ?? "";
        // Language picker should be one clean row per language, no bitrate
        // suffix and no `(English)` redundancy when the autonym already matches.
        expect(al).not.toMatch(/kbps|Mbps/);
        expect(al).not.toContain("(");
      }
    }
  });

  it("prefers split at low rungs when muxed and split share 360p", () => {
    // Invidious prefers split at 360p (unlike Piped, which keeps muxed itag 18
    // for fast start). Invidious VOD now routes to generated HLS, so this split
    // construction is reached via the shorts path.
    const w = buildWatchPlayback(
      base({
        videoSources: [
          {
            url: "https://g.example/360mux.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
            bitrate: 477_000,
          },
          {
            url: "https://g.example/360v-hi.mp4",
            quality: "360p",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 591_000,
          },
          {
            url: "https://g.example/360v-lo.mp4",
            quality: "360p",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 400_000,
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
      { shorts: true },
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].videoUrl).toBe("https://g.example/360v-hi.mp4");
      } else {
        throw new Error("Expected split variant to be selected for 360p");
      }
    }
  });

  it("keeps a single split per quality label (highest bitrate)", () => {
    const w = buildWatchPlayback(
      base({
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/1440-a.mp4",
            quality: "1440p60",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 12_000_000,
          },
          {
            url: "https://g.example/1440-b.mp4",
            quality: "1440p60",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 14_000_000,
          },
          {
            url: "https://g.example/1440-c.mp4",
            quality: "1440p60",
            videoOnly: true,
            mimeType: "video/mp4",
            bitrate: 13_000_000,
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].videoUrl).toBe("https://g.example/1440-b.mp4");
      }
    }
  });

  it("lists muxed and split variants when both exist (full quality menu)", () => {
    const w = buildWatchPlayback(
      base({
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
          {
            url: "https://g.example/360mux.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
          {
            url: "https://g.example/aud2.m4a",
            quality: "high",
            mimeType: "audio/mp4",
            language: "fr",
            audioTrackDisplayName: "French",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(2);
      expect(w.variants.map((v) => v.t)).toEqual(["split", "muxed"]);
      expect(w.variants.map((v) => v.label)).toEqual(["1080p", "360p"]);
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].audioOptions).toHaveLength(2);
      }
    }
  });

  it("lists one split row per video-only quality", () => {
    const w = buildWatchPlayback(
      base({
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
          {
            url: "https://g.example/720v.mp4",
            quality: "720p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(2);
      expect(w.variants.map((v) => v.label)).toEqual(["1080p", "720p"]);
    }
  });

  it("collapses multiple bitrate-only audio rows without language metadata into one split track", () => {
    const w = buildWatchPlayback(
      base({
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud-low.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            bitrate: 128_000,
          },
          {
            url: "https://g.example/aud-high.m4a",
            quality: "high",
            mimeType: "audio/mp4",
            bitrate: 256_000,
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive" && w.variants[0]?.t === "split") {
      expect(w.variants[0].audioOptions).toHaveLength(1);
      expect(w.variants[0].audioUrl).toBe("https://g.example/aud-high.m4a");
      expect(w.variants[0].defaultAudioIndex).toBe(0);
    }
  });

  it("uses split when there is no muxed stream", () => {
    const w = buildWatchPlayback(
      base({
        sourceUsed: "piped",
        mediaProxyBase: "https://g.example",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants).toHaveLength(1);
      expect(w.variants[0]?.t).toBe("split");
      if (w.variants[0]?.t === "split") {
        expect(w.variants[0].label).toBe("1080p");
        expect(w.variants[0].videoUrl).toBe("https://g.example/1080v.mp4");
        expect(w.variants[0].audioUrl).toBe("https://g.example/aud.m4a");
      }
    }
  });

  it("shorts mode includes split variants when available", () => {
    const w = buildWatchPlayback(
      base({
        hlsUrl: "https://h.example/playlist.m3u8",
        videoSources: [
          {
            url: "https://g.example/1080v.mp4",
            quality: "1080p",
            videoOnly: true,
            mimeType: "video/mp4",
            height: 1080,
          },
          {
            url: "https://g.example/360.mp4",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
            height: 360,
          },
        ],
        audioSources: [
          {
            url: "https://g.example/aud-en.m4a",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
          },
        ],
      }),
      { shorts: true },
    );
    expect(w.kind).toBe("progressive");
    if (w.kind !== "progressive") return;
    const labels = w.variants.map((v) => v.label);
    expect(labels).toContain("1080p");
    expect(labels).toContain("360p");
    expect(w.variants.some((v) => v.t === "split")).toBe(true);
  });
});

describe("buildWatchPlayback — Piped split vs HLS", () => {
  const pipedSplit = (over: Partial<VideoDetail>): VideoDetail =>
    base({
      sourceUsed: "piped",
      videoSources: [
        {
          url: "https://piped.example/videoplayback?itag=137",
          quality: "1080p",
          videoOnly: true,
          mimeType: "video/mp4",
        },
      ],
      audioSources: [
        {
          url: "https://piped.example/videoplayback?itag=140&lang=en",
          quality: "medium",
          mimeType: "audio/mp4",
          language: "en",
          audioTrackDisplayName: "English",
        },
      ],
      ...over,
    });

  it("prefers HLS over split for single-language Piped VOD (avoids A/V desync)", () => {
    const w = buildWatchPlayback(
      pipedSplit({ hlsUrl: "https://h.example/playlist.m3u8" }),
    );
    expect(w).toEqual({
      kind: "hls",
      url: "https://h.example/playlist.m3u8",
      onlyDashOrUnsupported: false,
    });
  });

  it("keeps progressive split for multi-language Piped VOD (HLS drops the picker)", () => {
    const w = buildWatchPlayback(
      pipedSplit({
        hlsUrl: "https://h.example/playlist.m3u8",
        audioSources: [
          {
            url: "https://piped.example/videoplayback?itag=140&lang=en",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "en",
            audioTrackDisplayName: "English",
          },
          {
            url: "https://piped.example/videoplayback?itag=140&lang=fr",
            quality: "medium",
            mimeType: "audio/mp4",
            language: "fr",
            audioTrackDisplayName: "French",
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants[0]?.t).toBe("split");
    }
  });

  it("falls back to progressive split for Piped VOD without an HLS URL", () => {
    const w = buildWatchPlayback(pipedSplit({}));
    expect(w.kind).toBe("progressive");
    if (w.kind === "progressive") {
      expect(w.variants[0]?.t).toBe("split");
    }
  });
});

describe("pickPlaybackForVidstack (compat)", () => {
  it("returns first progressive url", () => {
    const r = pickPlaybackForVidstack(
      base({
        videoSources: [
          { url: "https://g.example/360.mp4", quality: "360p" },
          { url: "https://g.example/1080.mp4", quality: "1080p" },
        ],
      }),
    );
    expect(r.src).toBe("https://g.example/1080.mp4");
  });
});
