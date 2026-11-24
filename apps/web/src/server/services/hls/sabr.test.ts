import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSabrMasterPlaylist,
  buildSabrMediaPlaylist,
  fetchSabrVod,
  generateSabrMasterPlaylist,
  generateSabrMediaPlaylist,
  parseSabrAv1Ladder,
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

/** The connector's `?video=av01` answer: the AV1 family ladder, own timeline. */
const AV1_MPD = MPD.replace(
  /<Representation id="v360"[\s\S]*?height="720" bandwidth="4206005"\/>/,
  [
    '<Representation id="av01-v720" codecs="av01.0.08M.08" width="1280" height="720" bandwidth="1500000"/>',
    '      <Representation id="av01-v2160" codecs="av01.0.13M.08" width="3840" height="2160" bandwidth="22000000"/>',
  ].join("\n"),
)
  .replace(
    /<S d="61952"\/>[\s\S]*?<S d="30720"\/>/,
    '<S d="4033"/>\n          <S d="4334"/>',
  )
  .replace('timescale="15360"', 'timescale="1000"');

describe("parseSabrAv1Ladder", () => {
  it("reads the AV1 rungs and their own timeline", () => {
    const ladder = parseSabrAv1Ladder(AV1_MPD);
    expect(ladder?.reps.map((r) => r.id)).toEqual(["av01-v720", "av01-v2160"]);
    expect(ladder?.timeline).toEqual({
      timescale: 1000,
      startNumber: 1,
      durations: [4033, 4334],
    });
  });

  it("is null when the connector fell back to its H.264 ladder", () => {
    expect(parseSabrAv1Ladder(MPD)).toBeNull();
  });
});

describe("buildSabrMasterPlaylist with an AV1 ladder", () => {
  it("lists AV1 first, then H.264, each highest first", () => {
    const vod = parseSabrVodManifest(MPD);
    const av1 = parseSabrAv1Ladder(AV1_MPD);
    if (!vod || !av1) throw new Error("fixture did not parse");
    const out = buildSabrMasterPlaylist({ ...vod, av1 });
    const variants = out
      .split("\n")
      .filter((l) => /^sabr\.m3u8\?track=(v|av01-)/.test(l));
    expect(variants).toEqual([
      "sabr.m3u8?track=av01-v2160",
      "sabr.m3u8?track=av01-v720",
      "sabr.m3u8?track=v1080",
      "sabr.m3u8?track=v720",
      "sabr.m3u8?track=v360",
    ]);
    expect(out).toContain(
      '#EXT-X-STREAM-INF:BANDWIDTH=22050452,RESOLUTION=3840x2160,CODECS="av01.0.13M.08,mp4a.40.5",AUDIO="aud"\nsabr.m3u8?track=av01-v2160',
    );
  });
});

describe("fetchSabrVod", () => {
  const COMPANION = "http://companion.test";
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("INVIDIOUS_COMPANION_INTERNAL_URL", COMPANION);
    vi.stubEnv("INVIDIOUS_COMPANION_SECRET_KEY", "");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("adds the AV1 ladder, and serves each track on its own timeline", async () => {
    fetchMock.mockImplementation(
      async (u: string | URL) =>
        new Response(String(u).includes("video=av01") ? AV1_MPD : MPD),
    );
    const id = "av1test0001";
    const master = await generateSabrMasterPlaylist(id, async () => []);
    expect(master).toContain("sabr.m3u8?track=av01-v2160");
    expect(master).toContain("sabr.m3u8?track=v1080");
    const av1 = await generateSabrMediaPlaylist(id, "av01-v2160");
    expect(av1).toContain("#EXTINF:4.033000,");
    expect(av1).toContain(`/dash/${id}/sabr/av01-v2160/seg-2.m4s`);
    const h264 = await generateSabrMediaPlaylist(id, "v1080");
    expect(h264).toContain("#EXTINF:4.033333,");
  });

  it("leaves AV1 out when INVIDIOUS_COMPANION_SABR_HLS_AV1=off", async () => {
    vi.stubEnv("INVIDIOUS_COMPANION_SABR_HLS_AV1", "off");
    fetchMock.mockImplementation(
      async (u: string | URL) =>
        new Response(String(u).includes("video=av01") ? AV1_MPD : MPD),
    );
    const vod = await fetchSabrVod("av1test0003");
    expect(vod?.av1).toBeUndefined();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("video=av01")),
    ).toBe(false);
  });

  it("keeps H.264 alone when the video has no AV1 or the AV1 fetch fails", async () => {
    fetchMock.mockImplementation(async (u: string | URL) =>
      String(u).includes("video=av01")
        ? new Response("", { status: 502 })
        : new Response(MPD),
    );
    const vod = await fetchSabrVod("av1test0002");
    expect(vod?.av1).toBeUndefined();
    expect(vod?.video.reps).toHaveLength(3);
  });
});
