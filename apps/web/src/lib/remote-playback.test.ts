import { describe, expect, it } from "vitest";
import {
  castButtonState,
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

describe("castButtonState", () => {
  const base = {
    receiverAvailable: true,
    disableRemotePlayback: false,
    currentSrc: "https://owntube.example/media/v.mp4",
  };

  it("hides the button when no receiver is known", () => {
    expect(castButtonState({ ...base, receiverAvailable: false })).toBe(
      "hidden",
    );
  });

  it("offers a plain URL source", () => {
    expect(castButtonState(base)).toBe("castable");
  });

  it("explains a Media Source (blob:) source can't be cast", () => {
    expect(castButtonState({ ...base, currentSrc: "blob:https://x/1" })).toBe(
      "unavailable",
    );
  });

  it("explains a source with remote playback disabled", () => {
    expect(castButtonState({ ...base, disableRemotePlayback: true })).toBe(
      "unavailable",
    );
  });
});
