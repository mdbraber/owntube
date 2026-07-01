import { describe, expect, it } from "vitest";
import { reorderVariantsForDefaultQuality } from "@/lib/default-playback-quality";
import { buildWatchPlayback } from "@/lib/pick-playback";
import type { VideoDetail } from "@/server/services/proxy.types";

function pipedDetail(over: Partial<VideoDetail>): VideoDetail {
  return {
    videoId: "9bZkp7q19f0",
    title: "t",
    audioSources: [
      {
        url: "http://192.168.1.11:8092/videoplayback?itag=140",
        quality: "medium",
        mimeType: "audio/mp4",
      },
    ],
    videoSources: [
      {
        url: "http://192.168.1.11:8092/videoplayback?itag=137",
        quality: "1080p",
        videoOnly: true,
        mimeType: 'video/mp4; codecs="avc1.640028"',
        height: 1080,
      },
      {
        url: "http://192.168.1.11:8092/videoplayback?itag=136",
        quality: "720p",
        videoOnly: true,
        mimeType: 'video/mp4; codecs="avc1.4d401f"',
        height: 720,
      },
      {
        url: "http://192.168.1.11:8092/videoplayback?itag=18",
        quality: "360p",
        videoOnly: false,
        mimeType: "video/mp4",
        height: 360,
      },
    ],
    sourceUsed: "piped",
    ...over,
  };
}

describe("buildWatchPlayback piped adaptive", () => {
  it("lists muxed 360p plus split HD rungs for Piped shorts", () => {
    const w = buildWatchPlayback(pipedDetail({}), { shorts: true });
    expect(w.kind).toBe("progressive");
    if (w.kind !== "progressive") return;
    const labels = w.variants.map((v) => v.label);
    expect(labels).toContain("1080p");
    expect(labels).toContain("720p");
    expect(labels).toContain("360p");
    expect(w.variants.some((v) => v.t === "split")).toBe(true);
    expect(w.variants.length).toBeGreaterThanOrEqual(3);
  });

  it("lists muxed 360p plus split HD rungs for Piped", () => {
    const w = buildWatchPlayback(pipedDetail({}));
    expect(w.kind).toBe("progressive");
    if (w.kind !== "progressive") return;
    const labels = w.variants.map((v) => v.label);
    expect(labels).toContain("1080p");
    expect(labels).toContain("720p");
    expect(labels).toContain("360p");
    expect(w.variants[0]?.t).toBe("split");
    expect(w.variants[0]?.label).toBe("1080p");
    expect(w.variants.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps muxed itag 18 when Piped reports height 0", () => {
    const w = buildWatchPlayback(
      pipedDetail({
        videoSources: [
          {
            url: "http://192.168.1.11:8092/videoplayback?itag=137",
            quality: "1080p",
            videoOnly: true,
            mimeType: 'video/mp4; codecs="avc1.640028"',
            height: 1080,
          },
          {
            url: "http://192.168.1.11:8092/videoplayback?itag=18",
            quality: "360p",
            videoOnly: false,
            mimeType: "video/mp4",
            height: 0,
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind !== "progressive") return;
    expect(w.variants.map((v) => v.label)).toContain("360p");
    expect(w.variants.map((v) => v.label)).toContain("1080p");
  });

  it("prefers HLS over split for single-language Piped (avoids A/V desync)", () => {
    const w = buildWatchPlayback(
      pipedDetail({
        hlsUrl: "https://piped.example/hls.m3u8",
      }),
    );
    // Single audio language: HLS is one muxed stream, so it sidesteps the
    // split <video>+<audio> path that drifts out of sync over time.
    expect(w).toEqual({
      kind: "hls",
      url: "https://piped.example/hls.m3u8",
      onlyDashOrUnsupported: false,
    });
  });

  it("reorders Piped variants for 720p and 360p-muxed preferences", () => {
    const w = buildWatchPlayback(pipedDetail({}));
    expect(w.kind).toBe("progressive");
    if (w.kind !== "progressive") return;
    const labels = w.variants.map((v) => v.label);
    const for720 = reorderVariantsForDefaultQuality(
      [...w.variants],
      "720p",
    ).map((v) => v.label);
    expect(for720[0]).toBe("720p");
    expect(for720).toEqual(expect.arrayContaining(labels));
    expect(for720).toHaveLength(labels.length);

    const forMuxed = reorderVariantsForDefaultQuality(
      [...w.variants],
      "360p-muxed",
    );
    expect(forMuxed[0]?.label).toBe("360p");
    expect(forMuxed[0]?.t).toBe("muxed");
  });

  it("without videoOnly flags only muxed legacy row remains", () => {
    const w = buildWatchPlayback(
      pipedDetail({
        videoSources: [
          {
            url: "http://192.168.1.11:8092/videoplayback?itag=18",
            quality: "360p",
            mimeType: "video/mp4",
            height: 360,
          },
        ],
      }),
    );
    expect(w.kind).toBe("progressive");
    if (w.kind !== "progressive") return;
    expect(w.variants).toHaveLength(1);
    expect(w.variants[0]?.label).toBe("360p");
  });
});
