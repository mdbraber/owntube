import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const s = require("./slack-memos.js");

test("youtubeVideoId reads every YouTube URL shape", () => {
  const id = "dQw4w9WgXcQ";
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?feature=share&v=${id}&t=42`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&list=RD`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}?feature=shared`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/watch?v=${id}&amp;t=1`,
  ]) {
    assert.equal(s.youtubeVideoId(url), id, url);
  }
  for (const url of [
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/@somechannel",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/short",
    "not a url",
  ]) {
    assert.equal(s.youtubeVideoId(url), null, url);
  }
});

test("videoIdsInMessage finds links in text and unfurls, once each", () => {
  const ids = s.videoIdsInMessage({
    text: "Two: <https://youtu.be/dQw4w9WgXcQ> and <https://www.youtube.com/watch?v=9bZkp7q19f0|this one>, again <https://youtu.be/dQw4w9WgXcQ>",
    attachments: [{ from_url: "https://www.youtube.com/shorts/jNQXAC9IVRw" }],
  });
  assert.deepEqual(ids, ["dQw4w9WgXcQ", "9bZkp7q19f0", "jNQXAC9IVRw"]);
});

test("slackToMarkdown converts mrkdwn", () => {
  const md = s.slackToMarkdown(
    "*Kijk* deze <https://youtu.be/dQw4w9WgXcQ|video>, <@U1> ~oud~ in <#C9|general> &amp; _cursief_\nnieuwe regel\n\n&gt; quote <!here>",
    { U1: "Anna" },
  );
  assert.equal(
    md,
    "**Kijk** deze [video](https://youtu.be/dQw4w9WgXcQ), @Anna ~~oud~~ in #general & _cursief_  \nnieuwe regel\n\n> quote @here",
  );
});

test("memoText ends with a link to the message", () => {
  const text = s.memoText(
    {
      text: "Mooi! <https://youtu.be/dQw4w9WgXcQ>",
      permalink: "https://metnerdsomtafel.slack.com/archives/C1/p1",
    },
    {},
  );
  assert.equal(
    text,
    "Mooi! https://youtu.be/dQw4w9WgXcQ\n\n[View in Slack](https://metnerdsomtafel.slack.com/archives/C1/p1)",
  );
  const long = s.memoText(
    { text: "x".repeat(6000), permalink: "https://s/p" },
    {},
  );
  assert.ok(long.length < 5000);
  assert.ok(long.endsWith("…\n\n[View in Slack](https://s/p)"));
});

test("memoInputs: one memo per message and video, no DMs, no repeats", () => {
  const config = { workspace: "metnerdsomtafel", playlistName: "MNOT Slack" };
  const msg = {
    ts: "1764247920.000200",
    user: "U1",
    username: "anna",
    text: "<https://youtu.be/dQw4w9WgXcQ> <https://youtu.be/9bZkp7q19f0>",
    permalink:
      "https://metnerdsomtafel.slack.com/archives/C1/p1764247920000200",
    channel: { id: "C1", name: "muziek" },
  };
  const inputs = s.memoInputs(
    [
      msg,
      { ...msg }, // same message again from the second query
      { ...msg, permalink: "https://x/dm", channel: { id: "D1", is_im: true } },
      { ...msg, permalink: "https://x/none", text: "no video here" },
    ],
    { U1: "Anna" },
    config,
  );
  assert.deepEqual(
    inputs.map((i) => i.videoId),
    ["dQw4w9WgXcQ", "9bZkp7q19f0"],
  );
  assert.deepEqual(inputs[0].source, {
    kind: "slack",
    url: msg.permalink,
    label: "#muziek",
    author: "Anna",
    workspace: "metnerdsomtafel",
  });
  assert.equal(inputs[0].occurredAt, "1764247920.000200");
  assert.equal(inputs[0].playlistName, "MNOT Slack");
});

test("searchAfter steps back whole days", () => {
  assert.equal(s.searchAfter("2026-11-27T12:00:00Z", 3), "2026-11-24");
});

test("works without a URL global, as in n8n's Code node sandbox", () => {
  const saved = globalThis.URL;
  globalThis.URL = undefined;
  try {
    assert.equal(
      s.youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "dQw4w9WgXcQ",
    );
    const inputs = s.memoInputs(
      [
        {
          ts: "1",
          text: "<https://youtu.be/dQw4w9WgXcQ>",
          permalink: "https://s/p",
          channel: { name: "x" },
        },
      ],
      {},
      { workspace: "w", playlistName: "p" },
    );
    assert.equal(inputs.length, 1);
  } finally {
    globalThis.URL = saved;
  }
});
