import { describe, expect, it } from "vitest";
import {
  isSignInRequiredUpstreamMessage,
  isVideoUnavailableUpstreamMessage,
  SIGN_IN_REQUIRED_REASON,
  UpstreamVideoUnavailableError,
} from "@/server/errors/upstream-video-unavailable";
import { throwIfUpstreamFailed } from "@/server/services/proxy/errors";

describe("isVideoUnavailableUpstreamMessage", () => {
  it("recognises YouTube's paywall refusals", () => {
    // Verbatim shapes YouTube puts in playabilityStatus.reason / subreason,
    // which Invidious relays unchanged. Before these were listed, each fell
    // through to the generic "Invidious is unavailable, check instance health"
    // message — blaming the instance for a per-video refusal.
    for (const message of [
      'invidious:{"error":"Join this channel to get access to members-only content like this video, and other exclusive perks."}',
      "invidious:This video is available to this channel's members on level: Tier 2 (or any higher level). Join this channel to get access to members-only content and other exclusive perks.",
      'invidious:{"error":"This video requires payment to watch."}',
    ]) {
      expect(isVideoUnavailableUpstreamMessage(message), message).toBe(true);
    }
  });

  it("still recognises the existing definitive refusals", () => {
    for (const message of [
      'invidious:{"error":"Video unavailable"}',
      "invidious:The uploader has not made this video available in your country",
      'invidious:{"error":"This video is private"}',
    ]) {
      expect(isVideoUnavailableUpstreamMessage(message), message).toBe(true);
    }
  });

  it("does not fire on ordinary videos that merely mention membership", () => {
    // These are real titles measured from live search results. A feed filter
    // matching the bare phrase dropped every one of them as members-only.
    for (const message of [
      "invidious:Drake - Members Only (Audio) ft. PARTYNEXTDOOR",
      "invidious:Members Only Videos are a HUGE Problem on YouTube",
      "invidious:How to Enable Subscribers Only Mode for Comments",
      "invidious:XXXTENTACION - Members Only VOL 1 (Full Album)",
    ]) {
      expect(isVideoUnavailableUpstreamMessage(message), message).toBe(false);
    }
  });

  it("leaves transient failures on the generic path", () => {
    for (const message of [
      "invidious:HTTP 502: bad gateway",
      "invidious:rate limit",
      "invidious:fetch failed",
    ]) {
      expect(isVideoUnavailableUpstreamMessage(message), message).toBe(false);
    }
  });
});

describe("isSignInRequiredUpstreamMessage", () => {
  it("recognises YouTube's bare login wall as Invidious relays it", () => {
    for (const message of [
      'invidious:HTTP 500: {"error":"Please sign in"}',
      'invidious:{"error":"Please sign in."}',
      "invidious:Please sign in",
    ]) {
      expect(isSignInRequiredUpstreamMessage(message), message).toBe(true);
    }
  });

  it("leaves the bot check and the age gate to their own paths", () => {
    for (const message of [
      'invidious:{"error":"Sign in to confirm you\u2019re not a bot"}',
      "invidious:Sign in to confirm your age",
      "invidious:Please sign in to continue to the admin panel at /login",
    ]) {
      expect(isSignInRequiredUpstreamMessage(message), message).toBe(false);
    }
  });

  it("turns the login wall into a per-video refusal with a clear reason", () => {
    let thrown: unknown;
    try {
      throwIfUpstreamFailed(
        ['invidious:HTTP 500: {"error":"Please sign in"}'],
        "fallback",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UpstreamVideoUnavailableError);
    expect((thrown as Error).message).toBe(SIGN_IN_REQUIRED_REASON);
  });
});
