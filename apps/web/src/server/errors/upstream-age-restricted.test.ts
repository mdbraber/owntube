import { describe, expect, it } from "vitest";
import { isAgeRestrictedUpstreamMessage } from "@/server/errors/upstream-age-restricted";

describe("isAgeRestrictedUpstreamMessage", () => {
  it("matches the Piped (NewPipe) age-restriction error", () => {
    const msg =
      'piped:HTTP 500: {"error":"org.schabi.newpipe.extractor.exceptions.AgeRestrictedContentException: This age-restricted video cannot be watched anonymously"}';
    expect(isAgeRestrictedUpstreamMessage(msg)).toBe(true);
  });

  it("matches the Invidious age-restriction error", () => {
    const msg =
      'invidious:HTTP 500: {"error":"This video may be inappropriate for some users."}';
    expect(isAgeRestrictedUpstreamMessage(msg)).toBe(true);
  });

  it("does not match unrelated upstream failures", () => {
    expect(isAgeRestrictedUpstreamMessage("piped:HTTP 502: bad gateway")).toBe(
      false,
    );
    expect(isAgeRestrictedUpstreamMessage("invidious:rate limit")).toBe(false);
  });
});
