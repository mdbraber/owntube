import { describe, expect, it } from "vitest";
import { buildWatchPlayback } from "@/lib/pick-playback";
import {
  alternateLiveUpstream,
  isPipedHostedProgressiveUrl,
  pickLivePlaybackDetail,
  pickRicherPlaybackDetail,
  playbackCatalogMaxHeightPx,
  shouldPreferInvidiousOverPiped,
} from "@/lib/upstream-playback-catalog";
import type { VideoDetail } from "@/server/services/proxy.types";

function detail(over: Partial<VideoDetail>): VideoDetail {
  return {
    videoId: "x",
    title: "t",
    audioSources: [],
    videoSources: [],
    sourceUsed: "piped",
    ...over,
  };
}

describe("upstream-playback-catalog", () => {
  it("flags Piped catalogs capped at 360p without split/HLS", () => {
    const piped = detail({
      videoSources: [
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=18",
          quality: "360p",
          mimeType: "video/mp4",
        },
      ],
    });
    expect(shouldPreferInvidiousOverPiped(piped)).toBe(true);
    expect(playbackCatalogMaxHeightPx(piped)).toBe(360);
  });

  it("does not prefer Invidious when Piped exposes split HD", () => {
    const piped = detail({
      audioSources: [
        { url: "http://x/videoplayback?itag=140", quality: "medium" },
      ],
      videoSources: [
        {
          url: "http://x/videoplayback?itag=137",
          quality: "1080p",
          videoOnly: true,
          height: 1080,
        },
      ],
    });
    expect(shouldPreferInvidiousOverPiped(piped)).toBe(false);
  });

  it("picks Invidious when it advertises higher rungs", () => {
    const piped = detail({
      videoSources: [
        { url: "http://x/videoplayback?itag=18", quality: "360p" },
      ],
    });
    const invidious = detail({
      sourceUsed: "invidious",
      audioSources: [{ url: "http://x/aud", quality: "medium" }],
      videoSources: [
        {
          url: "http://x/v1080",
          quality: "1080p",
          videoOnly: true,
          height: 1080,
        },
      ],
    });
    expect(pickRicherPlaybackDetail(piped, invidious).sourceUsed).toBe(
      "invidious",
    );
  });

  it("prefers Piped HLS for live by default", () => {
    const piped = detail({
      isLive: true,
      hlsUrl: "http://192.168.1.11:8092/manifest/live.m3u8",
    });
    const invidious = detail({
      sourceUsed: "invidious",
      isLive: true,
      hlsUrl: "http://192.168.1.11:3210/api/manifest/hls_variant/x.m3u8",
    });
    expect(pickLivePlaybackDetail(piped, invidious)?.sourceUsed).toBe("piped");
  });

  it("honors preferUpstream=invidious for live", () => {
    const piped = detail({
      isLive: true,
      hlsUrl: "http://192.168.1.11:8092/manifest/live.m3u8",
    });
    const invidious = detail({
      sourceUsed: "invidious",
      isLive: true,
      hlsUrl: "http://192.168.1.11:3210/api/manifest/hls_variant/x.m3u8",
    });
    expect(
      pickLivePlaybackDetail(piped, invidious, "invidious")?.sourceUsed,
    ).toBe("invidious");
  });

  it("alternateLiveUpstream swaps piped and invidious", () => {
    expect(alternateLiveUpstream("piped")).toBe("invidious");
    expect(alternateLiveUpstream("invidious")).toBe("piped");
    expect(alternateLiveUpstream("cache")).toBeNull();
  });

  it("drops non-videoplayback Piped muxed rows from watch variants", () => {
    const piped = detail({
      videoSources: [
        {
          url: "https://player.odycdn.com/v6/streams/x",
          quality: "LBRY",
          mimeType: "video/mp4",
        },
        {
          url: "http://192.168.1.11:8092/videoplayback?itag=18",
          quality: "360p",
          mimeType: "video/mp4",
        },
      ],
    });
    const w = buildWatchPlayback(piped);
    expect(w.kind).toBe("progressive");
    if (w.kind !== "progressive") return;
    expect(w.variants.map((v) => v.label)).toEqual(["360p"]);
    expect(
      isPipedHostedProgressiveUrl(
        piped,
        "https://player.odycdn.com/v6/streams/x",
      ),
    ).toBe(false);
  });
});
