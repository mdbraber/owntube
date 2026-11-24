import { describe, expect, it } from "vitest";
import {
  isPlayingRemotely,
  type RemoteAwareMedia,
} from "@/lib/remote-playback";

const media = (props: RemoteAwareMedia) => props;

describe("isPlayingRemotely", () => {
  it("is false for a locally playing element", () => {
    expect(isPlayingRemotely(media({}))).toBe(false);
    expect(
      isPlayingRemotely(
        media({
          webkitCurrentPlaybackTargetIsWireless: false,
          remote: { state: "disconnected" },
        }),
      ),
    ).toBe(false);
  });

  it("is true while AirPlaying from WebKit", () => {
    expect(
      isPlayingRemotely(media({ webkitCurrentPlaybackTargetIsWireless: true })),
    ).toBe(true);
  });

  it("is true for a connected Remote Playback session", () => {
    expect(isPlayingRemotely(media({ remote: { state: "connected" } }))).toBe(
      true,
    );
  });

  it("is false while a Remote Playback session is still connecting", () => {
    expect(isPlayingRemotely(media({ remote: { state: "connecting" } }))).toBe(
      false,
    );
  });
});
