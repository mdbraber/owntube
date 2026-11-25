import { describe, expect, it } from "vitest";
import {
  initSegmentFromSelfInitializing,
  mediaPartOfSelfInitializing,
  newestLiveSegmentPath,
  rewriteLiveManifestBaseUrls,
  segmentListToTemplate,
} from "@/server/services/dash/live-manifest";

/** YouTube's live manifest shape, as the companion's `/sabr` route serves it. */
function liveMpd(opts: {
  segments: number;
  startNumber?: number;
  timeline?: string;
  baseUrls?: string[];
}): string {
  const start = opts.startNumber ?? 100;
  const urls = Array.from(
    { length: opts.segments },
    (_, i) => `<SegmentURL media="sq/${start + i}/lmt/1"/>`,
  ).join("");
  const reps = (opts.baseUrls ?? ["live/abc/0/", "live/abc/1/"])
    .map(
      (b, i) =>
        `<Representation id="${140 + i}" bandwidth="1"><BaseURL>${b}</BaseURL><SegmentList>${urls}</SegmentList></Representation>`,
    )
    .join("");
  return (
    '<MPD type="dynamic" timeShiftBufferDepth="PT14400.000S" minimumUpdatePeriod="PT5.000S">' +
    `<Period start="PT500.000S"><SegmentList presentationTimeOffset="500000" startNumber="${start}" timescale="1000">` +
    `<SegmentTimeline>${opts.timeline ?? `<S d="5000" r="${opts.segments - 1}"/>`}</SegmentTimeline></SegmentList>` +
    `<AdaptationSet id="0" mimeType="audio/mp4">${reps}</AdaptationSet></Period></MPD>`
  );
}

describe("rewriteLiveManifestBaseUrls", () => {
  it("points each companion BaseURL at our segment proxy, keeping its index", () => {
    const out = rewriteLiveManifestBaseUrls(
      liveMpd({ segments: 2, baseUrls: ["live/c%3D%3D/0/", "live/-/7/"] }),
      "Ao58WyRJdg8",
    );
    expect(out).toContain("<BaseURL>/dash/Ao58WyRJdg8/live/0/</BaseURL>");
    expect(out).toContain("<BaseURL>/dash/Ao58WyRJdg8/live/7/</BaseURL>");
    expect(out).toContain('<SegmentURL media="sq/100/lmt/1"/>');
  });

  it("rejects a manifest with a BaseURL the browser couldn't fetch", () => {
    expect(
      rewriteLiveManifestBaseUrls(
        liveMpd({
          segments: 1,
          baseUrls: ["live/x/0/", "https://rr3---sn.googlevideo.com/vp/"],
        }),
        "Ao58WyRJdg8",
      ),
    ).toBeNull();
  });

  it("rejects a manifest with no BaseURL at all", () => {
    expect(
      rewriteLiveManifestBaseUrls(
        '<MPD type="dynamic"><Period/></MPD>',
        "Ao58WyRJdg8",
      ),
    ).toBeNull();
  });
});

describe("segmentListToTemplate", () => {
  it("turns the per-segment lists into a $Number$ template on YouTube's timeline", () => {
    const out = segmentListToTemplate(liveMpd({ segments: 3 }));
    expect(out).not.toBeNull();
    expect(out).not.toContain("<SegmentList");
    expect(out).not.toContain("<SegmentURL");
    // Once per Representation, BaseURL kept.
    expect(out).toContain(
      '<BaseURL>live/abc/0/</BaseURL><SegmentTemplate timescale="1000" ' +
        'presentationTimeOffset="0" startNumber="100" ' +
        'media="sq/$Number$/lmt/1" initialization="init">' +
        '<SegmentTimeline><S t="500000" d="5000" r="2"/></SegmentTimeline>' +
        "</SegmentTemplate>",
    );
    expect(out?.match(/<SegmentTemplate /g)).toHaveLength(2);
  });

  it("anchors an untimed timeline at presentationTimeOffset, rebased to a Period at 0", () => {
    // YouTube's segments' tfdt is sq × 5s: sq 100 at 500s, which the untimed
    // timeline means by presentationTimeOffset=500000 — dash.js would say 0.
    const out = segmentListToTemplate(liveMpd({ segments: 3 })) ?? "";
    expect(out).toContain('<Period start="PT0S">');
    expect(out).not.toContain('presentationTimeOffset="500000"');
    expect(out).toContain('<S t="500000" d="5000" r="2"/>');
  });

  it("re-anchors availabilityStartTime on the first segment's ingest time", () => {
    // A 24/7 stream: media time far older than YouTube's availabilityStartTime.
    const mpd = liveMpd({ segments: 3 })
      .replace("<MPD ", '<MPD availabilityStartTime="2026-09-21T04:43:51" ')
      .replace(
        '<Period start="PT500.000S"',
        '<Period start="PT500.000S" yt:segmentIngestTime="2026-09-21T18:31:45.002"',
      );
    const out = segmentListToTemplate(mpd) ?? "";
    // 18:31:45.002 minus the first segment's 500s of media time.
    expect(out).toContain('availabilityStartTime="2026-09-21T18:23:25.002Z"');
  });

  it("leaves availabilityStartTime alone without an ingest time", () => {
    const mpd = liveMpd({ segments: 3 }).replace(
      "<MPD ",
      '<MPD availabilityStartTime="2026-09-21T04:43:51" ',
    );
    expect(segmentListToTemplate(mpd)).toContain(
      'availabilityStartTime="2026-09-21T04:43:51"',
    );
  });

  it("keeps explicit times in unrolled and mixed-duration timelines", () => {
    const timeline =
      '<S t="1000" d="5000"/><S d="5000"/><S d="2000"/><S d="5000" r="1"/>';
    const out = segmentListToTemplate(liveMpd({ segments: 5, timeline }));
    expect(out).toContain(
      '<SegmentTimeline><S t="1000" d="5000" r="1"/><S d="2000"/><S d="5000" r="1"/></SegmentTimeline>',
    );
  });

  it("rejects a Representation whose list doesn't pair with the timeline", () => {
    const mpd = liveMpd({ segments: 3 }).replace(
      '<SegmentURL media="sq/102/lmt/1"/></SegmentList></Representation><Representation id="141"',
      '</SegmentList></Representation><Representation id="141"',
    );
    expect(segmentListToTemplate(mpd)).toBeNull();
  });

  it("rejects segment numbers a template can't express", () => {
    const gap = liveMpd({ segments: 3 }).replace(
      "sq/101/lmt/1",
      "sq/150/lmt/1",
    );
    expect(segmentListToTemplate(gap)).toBeNull();
    const mixed = liveMpd({ segments: 3 }).replace(
      "sq/101/lmt/1",
      "sq/101/lmt/2",
    );
    expect(segmentListToTemplate(mixed)).toBeNull();
  });

  it("rejects a multi-Period manifest", () => {
    const mpd = liveMpd({ segments: 3 }).replace(
      "</Period></MPD>",
      "</Period><Period/></MPD>",
    );
    expect(segmentListToTemplate(mpd)).toBeNull();
  });

  it("rejects an open-ended repeat", () => {
    const mpd = liveMpd({ segments: 3, timeline: '<S d="5000" r="-1"/>' });
    expect(segmentListToTemplate(mpd)).toBeNull();
  });
});

describe("newestLiveSegmentPath", () => {
  it("finds the last segment of the Representation at a BaseURL index", () => {
    const mpd = liveMpd({ segments: 3, baseUrls: ["live/c/0/", "live/c/5/"] });
    expect(newestLiveSegmentPath(mpd, "5")).toBe("sq/102/lmt/1");
    expect(newestLiveSegmentPath(mpd, "1")).toBeNull();
  });
});

describe("mediaPartOfSelfInitializing", () => {
  const box = (type: string, payload = 0) => {
    const b = new Uint8Array(8 + payload);
    new DataView(b.buffer).setUint32(0, b.length);
    b.set(new TextEncoder().encode(type), 4);
    return b;
  };
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  it("drops the repeated ftyp, moov and emsg before the moof", () => {
    const media = concat(box("moof", 30), box("mdat", 500));
    const segment = concat(
      box("ftyp", 20),
      box("moov", 100),
      box("emsg", 10),
      media,
    );
    expect(mediaPartOfSelfInitializing(segment)).toEqual(media);
  });

  it("leaves a plain media segment as it is", () => {
    const media = concat(box("moof", 30), box("mdat", 50));
    expect(mediaPartOfSelfInitializing(media)).toEqual(media);
  });

  it("returns the bytes unchanged when no moof follows", () => {
    const odd = concat(box("ftyp", 20), box("moov", 40));
    expect(mediaPartOfSelfInitializing(odd)).toEqual(odd);
  });
});

describe("initSegmentFromSelfInitializing", () => {
  const box = (type: string, payload = 0) => {
    const b = new Uint8Array(8 + payload);
    new DataView(b.buffer).setUint32(0, b.length);
    b.set(new TextEncoder().encode(type), 4);
    return b;
  };
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };

  it("keeps ftyp + moov and drops the media after them", () => {
    const init = concat(box("ftyp", 20), box("moov", 100));
    const segment = concat(
      init,
      box("emsg", 10),
      box("moof", 30),
      box("mdat", 500),
    );
    expect(initSegmentFromSelfInitializing(segment)).toEqual(init);
  });

  it("returns null without a moov", () => {
    expect(
      initSegmentFromSelfInitializing(concat(box("moof", 8), box("mdat", 8))),
    ).toBeNull();
  });
});
