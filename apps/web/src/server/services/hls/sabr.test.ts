import { describe, expect, it } from "vitest";
import {
  buildSabrMasterPlaylist,
  buildSabrMediaPlaylist,
  parseSabrVodManifest,
} from "@/server/services/hls/sabr";

/** Shaped like the connector's real output (aqz-KE-bpKQ, trimmed). */
const MPD = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011"
     type="static" mediaPresentationDuration="PT635S" minBufferTime="PT4S">
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1">
      <SegmentTemplate timescale="15360" startNumber="1"
                       initialization="$RepresentationID$/init.mp4?check=X" media="$RepresentationID$/seg-$Number$.m4s?check=X">
        <SegmentTimeline>
          <S d="61952"/>
          <S d="76800" r="2"/>
          <S d="30720"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="v360" codecs="avc1.4D401E" width="640" height="360" bandwidth="643723"/>
      <Representation id="v1080" codecs="avc1.64002A" width="1920" height="1080" bandwidth="6933529"/>
      <Representation id="v720" codecs="avc1.4D4020" width="1280" height="720" bandwidth="4206005"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="default" segmentAlignment="true" startWithSAP="1">
      <Label>default</Label>
      <SegmentTemplate timescale="44100" startNumber="1"
                       initialization="$RepresentationID$/init.mp4?check=X" media="$RepresentationID$/seg-$Number$.m4s?check=X">
        <SegmentTimeline>
          <S d="441000" r="1"/>
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="a-default" codecs="mp4a.40.5" audioSamplingRate="44100" bandwidth="50452"/>
    </AdaptationSet>
    <AdaptationSet contentType="text" mimeType="text/vtt" lang="en">
      <Label>English</Label>
      <Representation id="cap-en" bandwidth="0">
        <BaseURL>../../api/v1/captions/aqz-KE-bpKQ?lang=en&amp;check=X</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

describe("parseSabrVodManifest", () => {
  it("reads the ladder, the audio track and expands S@r", () => {
    const vod = parseSabrVodManifest(MPD);
    expect(vod).not.toBeNull();
    expect(vod?.video.reps.map((r) => r.id)).toEqual(["v360", "v1080", "v720"]);
    expect(vod?.video.reps[1]).toEqual({
      id: "v1080",
      codecs: "avc1.64002A",
      width: 1920,
      height: 1080,
      bandwidth: 6933529,
    });
    expect(vod?.video.timeline).toEqual({
      timescale: 15360,
      startNumber: 1,
      durations: [61952, 76800, 76800, 76800, 30720],
    });
    expect(vod?.audio).toEqual([
      {
        id: "a-default",
        codecs: "mp4a.40.5",
        bandwidth: 50452,
        lang: undefined,
        label: undefined,
        timeline: {
          timescale: 44100,
          startNumber: 1,
          durations: [441000, 441000],
        },
      },
    ]);
  });

  it("keeps a real language and label", () => {
    const vod = parseSabrVodManifest(
      MPD.replace('lang="default"', 'lang="nl"').replace(
        "<Label>default</Label>",
        "<Label>Nederlands</Label>",
      ),
    );
    expect(vod?.audio[0]?.lang).toBe("nl");
    expect(vod?.audio[0]?.label).toBe("Nederlands");
  });

  it("rejects a manifest without audio, video or a timeline", () => {
    const noAudio = MPD.replace(
      /<AdaptationSet mimeType="audio[\s\S]*?<\/AdaptationSet>/,
      "",
    );
    expect(parseSabrVodManifest(noAudio)).toBeNull();
    const noVideo = MPD.replace(
      /<AdaptationSet mimeType="video[\s\S]*?<\/AdaptationSet>/,
      "",
    );
    expect(parseSabrVodManifest(noVideo)).toBeNull();
    expect(
      parseSabrVodManifest(MPD.replaceAll(/<S d="\d+"(?: r="\d+")?\/>/g, "")),
    ).toBeNull();
    expect(parseSabrVodManifest("<html>not a manifest</html>")).toBeNull();
  });

  it("refuses an open-ended repeat it can't count", () => {
    expect(
      parseSabrVodManifest(
        MPD.replace('<S d="441000" r="1"/>', '<S d="441000" r="-1"/>'),
      ),
    ).toBeNull();
  });

  it("skips representations whose id our route would reject", () => {
    const vod = parseSabrVodManifest(MPD.replace('id="v360"', 'id="v/360"'));
    expect(vod?.video.reps.map((r) => r.id)).toEqual(["v1080", "v720"]);
  });
});

describe("buildSabrMasterPlaylist", () => {
  const vod = parseSabrVodManifest(MPD);
  if (!vod) throw new Error("fixture did not parse");

  it("lists the ladder highest first with one audio group", () => {
    expect(buildSabrMasterPlaylist(vod)).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="sabr.m3u8?track=a-default"',
        '#EXT-X-STREAM-INF:BANDWIDTH=6983981,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.5",AUDIO="aud"',
        "sabr.m3u8?track=v1080",
        '#EXT-X-STREAM-INF:BANDWIDTH=4256457,RESOLUTION=1280x720,CODECS="avc1.4D4020,mp4a.40.5",AUDIO="aud"',
        "sabr.m3u8?track=v720",
        '#EXT-X-STREAM-INF:BANDWIDTH=694175,RESOLUTION=640x360,CODECS="avc1.4D401E,mp4a.40.5",AUDIO="aud"',
        "sabr.m3u8?track=v360",
        "",
      ].join("\n"),
    );
  });

  it("advertises captions as a subtitles group", () => {
    const out = buildSabrMasterPlaylist(vod, [
      { label: "English", language_code: "en" },
    ]);
    expect(out).toContain(
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles.m3u8?lang=en"',
    );
    expect(out).toContain(
      ',AUDIO="aud",SUBTITLES="subs"\nsabr.m3u8?track=v1080',
    );
  });
});

describe("buildSabrMediaPlaylist", () => {
  it("maps the timeline onto numbered segments on our proxy", () => {
    expect(
      buildSabrMediaPlaylist("aqz-KE-bpKQ", "v720", {
        timescale: 15360,
        startNumber: 1,
        durations: [61952, 76800, 30720],
      }),
    ).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        "#EXT-X-TARGETDURATION:5",
        "#EXT-X-MEDIA-SEQUENCE:0",
        '#EXT-X-MAP:URI="/dash/aqz-KE-bpKQ/sabr/v720/init.mp4"',
        "#EXTINF:4.033333,",
        "/dash/aqz-KE-bpKQ/sabr/v720/seg-1.m4s",
        "#EXTINF:5.000000,",
        "/dash/aqz-KE-bpKQ/sabr/v720/seg-2.m4s",
        "#EXTINF:2.000000,",
        "/dash/aqz-KE-bpKQ/sabr/v720/seg-3.m4s",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    );
  });

  it("honours a startNumber other than 1", () => {
    const out = buildSabrMediaPlaylist("abcdefghijk", "a-default", {
      timescale: 1000,
      startNumber: 0,
      durations: [1000, 1000],
    });
    expect(out).toContain("/sabr/a-default/seg-0.m4s\n");
    expect(out).toContain("/sabr/a-default/seg-1.m4s\n");
  });
});
