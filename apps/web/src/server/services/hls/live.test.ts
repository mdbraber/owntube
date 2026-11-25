import { describe, expect, it } from "vitest";
import {
  LIVE_WINDOW_SEGMENTS,
  liveMasterPlaylist,
  liveMediaPlaylist,
  parseLiveManifest,
} from "./live";

/** Trimmed from a real `/dash/<id>/live.mpd` (a 24/7 stream). */
const MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:DASH:schema:MPD:2011" type="dynamic" minimumUpdatePeriod="PT5.000S">
<Period start="PT0S">
<AdaptationSet id="0" mimeType="audio/mp4" subsegmentAlignment="true">
<Representation id="139" codecs="mp4a.40.5" audioSamplingRate="22050" bandwidth="64000">
<BaseURL>/dash/vid/live/0/</BaseURL>
<SegmentTemplate timescale="1000" startNumber="100" media="sq/$Number$/lmt/918" initialization="init"><SegmentTimeline><S t="500000" d="5000" r="29"/></SegmentTimeline></SegmentTemplate>
</Representation>
<Representation id="140" codecs="mp4a.40.2" audioSamplingRate="44100" bandwidth="144000">
<BaseURL>/dash/vid/live/1/</BaseURL>
<SegmentTemplate timescale="1000" startNumber="100" media="sq/$Number$/lmt/918" initialization="init"><SegmentTimeline><S t="500000" d="5000" r="29"/></SegmentTimeline></SegmentTemplate>
</Representation>
</AdaptationSet>
<AdaptationSet id="1" mimeType="video/mp4" subsegmentAlignment="true">
<Representation id="160" codecs="avc1.42c00b" width="256" height="144" bandwidth="192223" frameRate="15">
<BaseURL>/dash/vid/live/2/</BaseURL>
<SegmentTemplate timescale="1000" startNumber="100" media="sq/$Number$/lmt/918" initialization="init"><SegmentTimeline><S t="500000" d="5000" r="29"/></SegmentTimeline></SegmentTemplate>
</Representation>
<Representation id="136" codecs="avc1.4d401f" width="1280" height="720" bandwidth="2187400" frameRate="30">
<BaseURL>/dash/vid/live/3/</BaseURL>
<SegmentTemplate timescale="1000" startNumber="100" media="sq/$Number$/lmt/918" initialization="init"><SegmentTimeline><S t="500000" d="5000" r="29"/></SegmentTimeline></SegmentTemplate>
</Representation>
<Representation id="137" codecs="avc1.640028" width="1920" height="1080" bandwidth="4199987" frameRate="30">
<BaseURL>/dash/vid/live/4/</BaseURL>
<SegmentTemplate timescale="1000" startNumber="100" media="sq/$Number$/lmt/918" initialization="init"><SegmentTimeline><S t="500000" d="5000" r="29"/></SegmentTimeline></SegmentTemplate>
</Representation>
<Representation id="399" codecs="av01.0.08M.08" width="1920" height="1080" bandwidth="3000000" frameRate="30">
<BaseURL>/dash/vid/live/5/</BaseURL>
<SegmentTemplate timescale="1000" startNumber="100" media="sq/$Number$/lmt/918" initialization="init"><SegmentTimeline><S t="500000" d="5000" r="29"/></SegmentTimeline></SegmentTemplate>
</Representation>
</AdaptationSet>
</Period>
</MPD>`;

describe("parseLiveManifest", () => {
  it("reads every representation with its numbered segments", () => {
    const reps = parseLiveManifest(MPD);
    expect(reps.map((r) => [r.kind, r.rep])).toEqual([
      ["audio", "0"],
      ["audio", "1"],
      ["video", "2"],
      ["video", "3"],
      ["video", "4"],
      ["video", "5"],
    ]);
    const hd = reps.find((r) => r.rep === "4");
    expect(hd).toMatchObject({ width: 1920, height: 1080, frameRate: 30 });
    // r="29" is the first segment plus 29 repeats.
    expect(hd?.segments).toHaveLength(30);
    expect(hd?.segments[0]).toEqual({ number: 100, seconds: 5 });
    expect(hd?.segments.at(-1)).toEqual({ number: 129, seconds: 5 });
  });
});

describe("liveMasterPlaylist", () => {
  const master = liveMasterPlaylist(parseLiveManifest(MPD)) ?? "";

  it("pairs every AVC rung with the best AAC track and skips AV1", () => {
    expect(master).toContain(
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="live-media.m3u8?rep=1"',
    );
    expect(master).toContain('CODECS="avc1.640028,mp4a.40.2"');
    expect(master).not.toContain("av01");
    expect(master).not.toContain("rep=0");
  });

  it("starts on the rung nearest 720p, then the rest from the lowest", () => {
    const variants = master
      .split("\n")
      .filter((l) => l.startsWith("live-media.m3u8"));
    expect(variants).toEqual([
      "live-media.m3u8?rep=3",
      "live-media.m3u8?rep=2",
      "live-media.m3u8?rep=4",
    ]);
  });

  it("gives up without audio or AVC video", () => {
    const videoOnly = parseLiveManifest(MPD).filter((r) => r.kind === "video");
    expect(liveMasterPlaylist(videoOnly)).toBeNull();
  });
});

describe("liveMediaPlaylist", () => {
  const hd = parseLiveManifest(MPD).find((r) => r.rep === "4");
  const playlist = hd ? liveMediaPlaylist(hd) : "";

  it("lists the newest window of segments at the existing segment routes", () => {
    const uris = playlist.split("\n").filter((l) => l.startsWith("/dash/"));
    expect(uris).toHaveLength(LIVE_WINDOW_SEGMENTS);
    expect(uris.at(-1)).toBe("/dash/vid/live/4/sq/129/lmt/918?hls=1");
    expect(playlist).toContain(
      `#EXT-X-MEDIA-SEQUENCE:${130 - LIVE_WINDOW_SEGMENTS}`,
    );
    expect(playlist).toContain('#EXT-X-MAP:URI="/dash/vid/live/4/init"');
    expect(playlist).toContain("#EXT-X-TARGETDURATION:5");
  });

  it("stays open, as live playlists do", () => {
    expect(playlist).not.toContain("#EXT-X-ENDLIST");
  });
});
