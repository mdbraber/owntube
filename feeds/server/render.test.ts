import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type FeedSnapshot,
  hms,
  renderRss,
  rfc822,
  xmlEscape,
} from "./render.ts";

const sample: FeedSnapshot = {
  kind: "playlist",
  owner: "m",
  slug: "cooking",
  title: "Cooking & Baking",
  description: "Best <recipes>",
  link: "https://owntube.home.nedworks.org/playlist?list=3",
  image: "https://owntube-media.home.nedworks.org/thumb.jpg",
  updatedAt: 1_700_000_000,
  items: [
    {
      videoId: "abc123XYZ_-",
      title: 'Knife "skills" & more',
      description: "Chop chop",
      durationSeconds: 3725,
      publishedAt: 1_689_000_000,
      thumbnailUrl: "https://owntube-media.home.nedworks.org/i/abc.jpg",
      channelName: "Chef",
      enclosureAudio:
        "https://owntube-media.home.nedworks.org/media/abc123XYZ_-.m4a",
      enclosureVideo:
        "https://owntube-media.home.nedworks.org/media/abc123XYZ_-.mp4",
    },
  ],
};

test("xmlEscape escapes the five entities", () => {
  assert.equal(xmlEscape(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&apos;f");
});

test("hms formats durations", () => {
  assert.equal(hms(3725), "1:02:05");
  assert.equal(hms(65), "1:05");
  assert.equal(hms(0), "0:00");
});

test("rfc822 renders a GMT date", () => {
  assert.equal(rfc822(0), "Thu, 01 Jan 1970 00:00:00 GMT");
});

test("audio feed uses the m4a enclosure and audio/mp4 type", () => {
  const xml = renderRss(sample, "audio", {
    selfUrl: "https://pub/rss/playlist/cooking.audio.xml",
  });
  assert.match(
    xml,
    /<enclosure url="https:\/\/owntube-media\.home\.nedworks\.org\/media\/abc123XYZ_-\.m4a" type="audio\/mp4"/,
  );
  assert.doesNotMatch(xml, /\.mp4"/);
  assert.match(xml, /<itunes:duration>1:02:05<\/itunes:duration>/);
  assert.match(xml, /<guid isPermaLink="false">abc123XYZ_-<\/guid>/);
  assert.match(xml, /rel="self"/);
  // Title text is escaped.
  assert.match(xml, /Knife &quot;skills&quot; &amp; more/);
});

test("video feed uses the mp4 enclosure and video/mp4 type", () => {
  const xml = renderRss(sample, "video");
  assert.match(xml, /<enclosure url="[^"]+\.mp4" type="video\/mp4"/);
  assert.match(xml, /<title>Cooking &amp; Baking \(Video\)<\/title>/);
});

test("well-formed: balanced item tags, one per feed item", () => {
  const xml = renderRss(sample, "audio");
  assert.equal((xml.match(/<item>/g) ?? []).length, 1);
  assert.equal((xml.match(/<\/item>/g) ?? []).length, 1);
  assert.ok(xml.startsWith('<?xml version="1.0"'));
  assert.ok(xml.trimEnd().endsWith("</rss>"));
});

test("items with chapters reference the JSON chapters endpoint", () => {
  const feed: FeedSnapshot = {
    ...sample,
    items: sample.items.map((it) => ({
      ...it,
      chapters: [{ startSeconds: 0, title: "Intro" }],
    })),
  };
  const xml = renderRss(feed, "audio", {
    selfUrl: "https://owntube.example/rss/playlist/cooking.audio.xml",
  });
  assert.match(
    xml,
    /xmlns:podcast="https:\/\/podcastindex\.org\/namespace\/1\.0"/,
  );
  assert.match(
    xml,
    /<podcast:chapters url="https:\/\/owntube\.example\/chapters\/abc123XYZ_-\.json" type="application\/json\+chapters"\/>/,
  );
  // Without a self URL there is no origin to build the link from.
  const bare = renderRss(feed, "audio");
  assert.doesNotMatch(bare, /podcast:chapters url=/);
});

test("channel artwork falls back to the public icon when the feed has none", () => {
  // A feed with no image of its own must still advertise cover art. Podcast
  // platforms fetch artwork server-side — off the LAN, and without the feed's
  // credentials — so a private URL leaves them storing the podcast with no
  // image at all, which is exactly how the OwnTube logo went missing.
  const { image: _dropped, ...noImage } = sample;
  const xml = renderRss(noImage, "video", {
    selfUrl: "https://owntube.example.org/queue.rss",
  });
  assert.ok(
    xml.includes('<itunes:image href="https://owntube.example.org/icon.png"/>'),
  );
  assert.ok(xml.includes("<url>https://owntube.example.org/icon.png</url>"));
});

test("a feed's own artwork still wins over the fallback", () => {
  const xml = renderRss(sample, "video", {
    selfUrl: "https://owntube.example.org/queue.rss",
  });
  assert.ok(
    xml.includes(
      '<itunes:image href="https://owntube-media.home.nedworks.org/thumb.jpg"/>',
    ),
  );
  assert.ok(!xml.includes("/icon.png"));
});

test("no self URL means no invented artwork", () => {
  // The origin is the only thing that makes /icon.png addressable; without it a
  // guessed URL would be worse than none.
  const { image: _dropped, ...noImage } = sample;
  const xml = renderRss(noImage, "video", {});
  assert.ok(!xml.includes("/icon.png"));
});

test("hub link is advertised when configured; credentials stay out of derived URLs", () => {
  const xml = renderRss(sample, "audio", {
    selfUrl: "https://alice:pw@pub.example/rss/playlist/cooking.audio.xml",
    hubUrl: "https://websub.example/",
  });
  assert.match(xml, /<atom:link href="https:\/\/websub\.example\/" rel="hub"\/>/);
  assert.match(
    xml,
    /<atom:link href="https:\/\/alice:pw@pub\.example\/rss\/playlist\/cooking\.audio\.xml" rel="self"/,
  );
  // sample sets its own image, so only the self link's href carries credentials.
  assert.equal((xml.match(/alice:pw@/g) ?? []).length, 1);
  assert.doesNotMatch(renderRss(sample, "audio"), /rel="hub"/);
});
