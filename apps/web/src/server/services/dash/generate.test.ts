import { describe, expect, it } from "vitest";
import {
  buildMpd,
  pickDashVideoFormats,
} from "@/server/services/dash/generate";
import type { AdaptiveFormat } from "@/server/services/hls/generate";

const vp9_2160: AdaptiveFormat = {
  itag: 313,
  type: 'video/webm; codecs="vp9"',
  url: "https://inv.example/videoplayback?itag=313&dur=562.433&x=1",
  init: "0-219",
  index: "220-2999",
  bitrate: 12_000_000,
  size: "3840x2160",
  fps: 30,
};

const vp9_1080: AdaptiveFormat = {
  itag: 248,
  type: 'video/webm; codecs="vp9"',
  url: "https://inv.example/videoplayback?itag=248&dur=562.433",
  init: "0-219",
  index: "220-1999",
  bitrate: 2_500_000,
  size: "1920x1080",
  fps: 30,
};

const avc_1080: AdaptiveFormat = {
  itag: 137,
  type: 'video/mp4; codecs="avc1.640028"',
  url: "https://inv.example/videoplayback?itag=137&dur=562.433",
  init: "0-740",
  index: "741-2091",
  bitrate: 4_600_000,
  size: "1920x1080",
  fps: 30,
};

const aac: AdaptiveFormat = {
  itag: 140,
  type: 'audio/mp4; codecs="mp4a.40.2"',
  url: "https://inv.example/videoplayback?itag=140&dur=562.433",
  init: "0-722",
  index: "723-1438",
  bitrate: 130_000,
};

describe("pickDashVideoFormats", () => {
  it("keeps only the requested family, best bitrate first, deduped", () => {
    const picked = pickDashVideoFormats(
      [avc_1080, vp9_1080, vp9_2160, vp9_1080, aac],
      "vp9",
    );
    expect(picked.map((f) => f.itag)).toEqual([313, 248]);
  });

  it("returns empty when the family is not offered", () => {
    expect(pickDashVideoFormats([avc_1080, aac], "av01")).toEqual([]);
  });
});

describe("buildMpd", () => {
  it("emits a static VOD MPD with SegmentBase byte ranges", () => {
    const mpd = buildMpd([vp9_2160, vp9_1080], aac, 562.433);
    expect(mpd).toContain('type="static"');
    expect(mpd).toContain('mediaPresentationDuration="PT562.433S"');
    expect(mpd).toContain('mimeType="video/webm"');
    expect(mpd).toContain('mimeType="audio/mp4"');
    expect(mpd).toContain('codecs="vp9"');
    expect(mpd).toContain('width="3840" height="2160"');
    expect(mpd).toContain('<SegmentBase indexRange="220-2999">');
    expect(mpd).toContain('<Initialization range="0-219"/>');
    expect(mpd).toContain('codecs="mp4a.40.2"');
  });

  it("XML-escapes ampersands in stream URLs", () => {
    const mpd = buildMpd([vp9_2160], aac, 562);
    expect(mpd).toContain("itag=313&amp;dur=562.433&amp;x=1");
    expect(mpd).not.toMatch(/<BaseURL>[^<]*&(?!amp;)/);
  });
});
