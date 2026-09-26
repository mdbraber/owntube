import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchTarget, redact, topicHostname, topicKey } from "./topic.ts";

const PATH = "/rss/queue/queue.audio.xml";

test("the password never takes part in matching", () => {
  assert.equal(
    topicKey(`https://alice:secret@owntube.example${PATH}`),
    topicKey(`https://alice@owntube.example${PATH}`),
  );
  assert.equal(
    topicKey(`https://alice:secret@owntube.example${PATH}`),
    topicKey(`https://alice:other@owntube.example${PATH}`),
  );
});

test("the username does take part: two users' feeds share a path", () => {
  assert.notEqual(
    topicKey(`https://alice@owntube.example${PATH}`),
    topicKey(`https://bob@owntube.example${PATH}`),
  );
  assert.notEqual(
    topicKey(`https://alice@owntube.example${PATH}`),
    topicKey(`https://owntube.example${PATH}`),
  );
});

test("encoding differences in username and path still match", () => {
  assert.equal(
    topicKey(`https://m%40example.com:pw@owntube.example${PATH}`),
    topicKey(`https://m@example.com:pw@owntube.example${PATH}`),
  );
  assert.equal(
    topicKey("https://a@owntube.example/rss/playlist/r%c3%a9sum%c3%a9.audio.xml"),
    topicKey("https://a@owntube.example/rss/playlist/r%C3%A9sum%C3%A9.audio.xml"),
  );
  assert.equal(
    topicKey("https://a@OwnTube.Example/rss/q.xml"),
    topicKey("https://a@owntube.example/rss/q.xml"),
  );
});

test("non-http topics are rejected", () => {
  assert.equal(topicKey("ftp://owntube.example/x"), null);
  assert.equal(topicKey("not a url"), null);
  assert.equal(topicHostname("not a url"), null);
  assert.equal(topicHostname(`https://a:b@owntube.example:8443${PATH}`), "owntube.example");
});

test("fetchTarget moves credentials into a Basic header", () => {
  const t = fetchTarget(`https://m%40example.com:p%3Ass@owntube.example${PATH}`);
  assert.equal(t.url, `https://owntube.example${PATH}`);
  assert.equal(
    t.authorization,
    `Basic ${Buffer.from("m@example.com:p:ss").toString("base64")}`,
  );
  assert.deepEqual(fetchTarget(`https://owntube.example${PATH}`), {
    url: `https://owntube.example${PATH}`,
  });
});

test("redact hides the password only", () => {
  assert.equal(
    redact(`https://alice:secret@owntube.example${PATH}`),
    `https://alice:***@owntube.example${PATH}`,
  );
  assert.equal(redact(`https://owntube.example${PATH}`), `https://owntube.example${PATH}`);
});
