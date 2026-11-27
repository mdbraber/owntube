import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSecretPath,
  redactPath,
  redactToken,
  secretFeedPath,
} from "./secret-urls.ts";

const T = "0123456789abcdef0123456789abcdef";

test("secret feed paths round-trip", () => {
  const p = secretFeedPath(T, "playlist", "tech talks", "video");
  assert.equal(p, `/rss/${T}/playlist/tech%20talks.video.xml`);
  assert.deepEqual(parseSecretPath(p), {
    token: T,
    kind: "playlist",
    slug: "tech talks",
    variant: "video",
  });
});

test("index and opml pages", () => {
  assert.deepEqual(parseSecretPath(`/rss/${T}/`), { token: T, page: "index" });
  assert.deepEqual(parseSecretPath(`/rss/${T}/opml.xml`), {
    token: T,
    page: "opml",
  });
});

test("protected paths and malformed tokens are not secret paths", () => {
  assert.equal(parseSecretPath("/rss/queue/queue.audio.xml"), null);
  assert.equal(
    parseSecretPath(`/rss/${T.toUpperCase()}/queue/queue.audio.xml`),
    null,
  );
  assert.equal(
    parseSecretPath(`/rss/${T.slice(1)}/queue/queue.audio.xml`),
    null,
  );
  assert.equal(parseSecretPath(`/rss/${T}`), null);
  assert.equal(parseSecretPath(`/rss/${T}/queue/%E0%A4%A.audio.xml`), null);
  // a 32-hex slug on the protected route stays protected (3 segments, not 4)
  assert.equal(parseSecretPath(`/rss/queue/${T}.audio.xml`), null);
});

test("redactToken keeps only a short prefix", () => {
  assert.equal(redactToken(T), "012345…");
});

test("redactPath redacts a leading token segment, leaves other paths alone", () => {
  const redacted = redactPath(`/rss/${T}/queue.audio.xml`);
  assert.equal(redacted, "/rss/012345…/queue.audio.xml");
  assert.equal(redacted.includes(T), false);
  assert.equal(redactPath(`/rss/${T}`), "/rss/012345…");
  assert.equal(redactPath(`/rss/${T}/`), "/rss/012345…/");
  assert.equal(
    redactPath("/rss/queue/queue.audio.xml"),
    "/rss/queue/queue.audio.xml",
  );
  assert.equal(
    redactPath(`/rss/${T.slice(1)}/queue.audio.xml`),
    `/rss/${T.slice(1)}/queue.audio.xml`,
  );
});
