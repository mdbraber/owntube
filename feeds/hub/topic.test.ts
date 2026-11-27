import assert from "node:assert/strict";
import { test } from "node:test";
import { redact, topicHostname, topicKey } from "./topic.ts";

const TOKEN = "abcdef0123456789abcdef0123456789";
const PATH = `/rss/${TOKEN}/queue/queue.audio.xml`;

test("encoding differences in host and path still match", () => {
  assert.equal(
    topicKey(
      `https://owntube.example/rss/${TOKEN}/playlist/r%c3%a9sum%c3%a9.audio.xml`,
    ),
    topicKey(
      `https://owntube.example/rss/${TOKEN}/playlist/r%C3%A9sum%C3%A9.audio.xml`,
    ),
  );
  assert.equal(
    topicKey(`https://OwnTube.Example${PATH}`),
    topicKey(`https://owntube.example${PATH}`),
  );
});

test("two users' feeds differ by their token", () => {
  assert.notEqual(
    topicKey(`https://owntube.example${PATH}`),
    topicKey(
      `https://owntube.example/rss/${"1".repeat(32)}/queue/queue.audio.xml`,
    ),
  );
});

test("non-http topics and topics with credentials are rejected", () => {
  assert.equal(topicKey("ftp://owntube.example/x"), null);
  assert.equal(topicKey("not a url"), null);
  assert.equal(topicKey(`https://alice:pw@owntube.example${PATH}`), null);
  assert.equal(topicKey(`https://alice@owntube.example${PATH}`), null);
  assert.equal(topicHostname("not a url"), null);
  assert.equal(
    topicHostname(`https://owntube.example:8443${PATH}`),
    "owntube.example",
  );
});

test("redact hides a leading secret-address token", () => {
  assert.equal(
    redact(`https://owntube.example${PATH}`),
    "https://owntube.example/rss/abcdef…/queue/queue.audio.xml",
  );
  assert.equal(
    redact(`https://owntube.example/rss/${TOKEN}/`),
    "https://owntube.example/rss/abcdef…/",
  );
  assert.equal(
    redact(`https://owntube.example/rss/${TOKEN}/opml.xml`),
    "https://owntube.example/rss/abcdef…/opml.xml",
  );
});

test("redact leaves other paths unchanged", () => {
  assert.equal(
    redact("https://owntube.example/rss/not-a-token/queue.audio.xml"),
    "https://owntube.example/rss/not-a-token/queue.audio.xml",
  );
});
