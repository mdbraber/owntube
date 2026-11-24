import { describe, expect, it } from "vitest";
import { castFlavor } from "@/lib/cast-flavor";

describe("castFlavor", () => {
  it("is AirPlay where WebKit's AirPlay events exist", () => {
    expect(
      castFlavor({ WebKitPlaybackTargetAvailabilityEvent: class {} }),
    ).toBe("airplay");
  });

  it("is Cast everywhere else", () => {
    expect(castFlavor({})).toBe("cast");
  });

  it("is Cast on the server", () => {
    expect(castFlavor(undefined)).toBe("cast");
  });
});
