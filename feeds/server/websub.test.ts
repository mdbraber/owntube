import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FeedStore } from "./store.ts";
import {
  channelIdFromTopic,
  parseNotification,
  topicFor,
  verifySignature,
} from "./websub.ts";

const CH = "UCabcdefghijklmnopqrstuv";
const CH2 = "UCzyxwvutsrqponmlkjihgfe";

const NEW_VIDEO = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <link rel="hub" href="https://pubsubhubbub.appspot.com"/>
 <link rel="self" href="https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CH}"/>
 <title>YouTube video feed</title>
 <updated>2026-09-26T10:00:01.552394234+00:00</updated>
 <entry>
  <id>yt:video:dQw4w9WgXcQ</id>
  <yt:videoId>dQw4w9WgXcQ</yt:videoId>
  <yt:channelId>${CH}</yt:channelId>
  <title>Tom &amp; Jerry &lt;live&gt;</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
  <author>
   <name>Some Channel</name>
   <uri>https://www.youtube.com/channel/${CH}</uri>
  </author>
  <published>2026-09-26T09:59:00+00:00</published>
  <updated>2026-09-26T10:00:01.552394234+00:00</updated>
 </entry>
</feed>`;

const DELETED = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:at="http://purl.org/atompub/tombstones/1.0" xmlns="http://www.w3.org/2005/Atom">
  <at:deleted-entry ref="yt:video:dQw4w9WgXcQ" when="2026-09-26T11:00:00.1+00:00">
   <link href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
   <at:by>
    <name>Some Channel</name>
    <uri>https://www.youtube.com/channel/${CH}</uri>
   </at:by>
  </at:deleted-entry>
</feed>`;

function freshStore(): FeedStore {
  return new FeedStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "feeds-server-websub-")),
  );
}

test("topic round-trips; foreign topics are rejected", () => {
  assert.equal(channelIdFromTopic(topicFor(CH)), CH);
  assert.equal(
    channelIdFromTopic(
      `https://evil.example/xml/feeds/videos.xml?channel_id=${CH}`,
    ),
    null,
  );
  assert.equal(
    channelIdFromTopic(
      "https://www.youtube.com/xml/feeds/videos.xml?channel_id=nope",
    ),
    null,
  );
});

test("parses a new-video notification", () => {
  const [e, ...rest] = parseNotification(NEW_VIDEO);
  assert.equal(rest.length, 0);
  assert.deepEqual(e, {
    channelId: CH,
    videoId: "dQw4w9WgXcQ",
    deleted: false,
    title: "Tom & Jerry <live>",
    author: "Some Channel",
    publishedAt: Date.parse("2026-09-26T09:59:00Z") / 1000,
    updatedAt: Math.floor(Date.parse("2026-09-26T10:00:01.552Z") / 1000),
  });
});

test("parses a deletion tombstone", () => {
  const [e] = parseNotification(DELETED);
  assert.equal(e.videoId, "dQw4w9WgXcQ");
  assert.equal(e.channelId, CH);
  assert.equal(e.deleted, true);
});

test("signature: sha1 HMAC over the raw body", () => {
  const body = Buffer.from(NEW_VIDEO);
  const sig = createHmac("sha1", "s3cret").update(body).digest("hex");
  assert.equal(verifySignature(body, `sha1=${sig}`, "s3cret"), true);
  assert.equal(verifySignature(body, `sha1=${sig}`, "other"), false);
  assert.equal(verifySignature(body, undefined, "s3cret"), false);
  assert.equal(verifySignature(body, "sha1=zz", "s3cret"), false);
});

test("subscribe lifecycle: due → requested → verified → renew", () => {
  const store = freshStore();
  const t0 = 1_800_000_000;
  store.setWebSubWanted([CH]);
  assert.deepEqual(store.webSubDue(t0, 10), {
    subscribe: [CH],
    unsubscribe: [],
  });

  store.markWebSubRequested(CH, "subscribe", t0, null);
  // Waiting on the hub's verification: not due again straight away.
  assert.deepEqual(store.webSubDue(t0 + 60, 10).subscribe, []);

  assert.equal(store.verifyWebSub(CH, "subscribe", 432_000, t0 + 5), true);
  assert.deepEqual(store.webSubDue(t0 + 60, 10).subscribe, []);
  assert.equal(store.webSubStats(t0 + 60).active, 1);
  // Renewal kicks in a day before the lease ends.
  assert.deepEqual(store.webSubDue(t0 + 5 + 432_000 - 3600, 10).subscribe, [
    CH,
  ]);
});

test("an unsolicited verification is answered but does not move the lease", () => {
  const store = freshStore();
  const t0 = 1_800_000_000;
  store.setWebSubWanted([CH]);
  assert.equal(store.verifyWebSub(CH, "subscribe", 432_000, t0), true);
  assert.deepEqual(store.webSubDue(t0, 10).subscribe, [CH]);
  // Not wanted at all → refused.
  assert.equal(store.verifyWebSub(CH2, "subscribe", 432_000, t0), false);
});

test("dropped channels are unsubscribed, then forgotten", () => {
  const store = freshStore();
  const t0 = 1_800_000_000;
  store.setWebSubWanted([CH]);
  store.markWebSubRequested(CH, "subscribe", t0, null);
  store.verifyWebSub(CH, "subscribe", 432_000, t0);

  store.setWebSubWanted([]);
  assert.deepEqual(store.webSubDue(t0 + 10, 10), {
    subscribe: [],
    unsubscribe: [CH],
  });
  // A subscribe verification for an unwanted channel is refused…
  assert.equal(store.verifyWebSub(CH, "subscribe", 432_000, t0 + 20), false);
  // …the unsubscribe one accepted, and the row goes away.
  store.markWebSubRequested(CH, "unsubscribe", t0 + 10, null);
  assert.equal(store.verifyWebSub(CH, "unsubscribe", 0, t0 + 20), true);
  assert.equal(store.webSubStats(t0 + 20).wanted, 0);
  assert.deepEqual(store.webSubDue(t0 + 30, 10), {
    subscribe: [],
    unsubscribe: [],
  });
});

test("failed hub requests back off", () => {
  const store = freshStore();
  const t0 = 1_800_000_000;
  store.setWebSubWanted([CH]);
  store.markWebSubRequested(CH, "subscribe", t0, "hub 500");
  store.markWebSubRequested(CH, "subscribe", t0, "hub 500");
  assert.deepEqual(store.webSubDue(t0 + 900, 10).subscribe, []);
  assert.deepEqual(store.webSubDue(t0 + 1800, 10).subscribe, [CH]);
  assert.equal(store.webSubStats(t0).failing, 1);
});

test("events dedupe, drain in order, and are deleted once acked", () => {
  const store = freshStore();
  const t0 = 1_800_000_000;
  const [e] = parseNotification(NEW_VIDEO);
  const [d] = parseNotification(DELETED);
  assert.equal(store.addWebSubEvents([e, e], t0), 1);
  assert.equal(store.addWebSubEvents([d], t0), 1);

  const batch = store.drainWebSubEvents(null, 10, t0);
  assert.deepEqual(
    batch.map((x) => [x.videoId, x.deleted]),
    [
      ["dQw4w9WgXcQ", false],
      ["dQw4w9WgXcQ", true],
    ],
  );
  // Unacked → redelivered.
  assert.equal(store.drainWebSubEvents(null, 10, t0).length, 2);
  assert.equal(store.drainWebSubEvents(batch[1].id, 10, t0).length, 0);
});
