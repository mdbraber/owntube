import { describe, expect, it } from "vitest";
import { normalizeYoutubeChannelId } from "@/lib/youtube-channel-id";

describe("normalizeYoutubeChannelId", () => {
  it("pulls UC id out of title+id concatenation", () => {
    expect(
      normalizeYoutubeChannelId("PlayStationUC-2Y8dQb0S6DtpxNgAKoJKA"),
    ).toBe("UC-2Y8dQb0S6DtpxNgAKoJKA");
    expect(
      normalizeYoutubeChannelId("slash animUC-1c7ebjoZoh1yTM6qL3R7g"),
    ).toBe("UC-1c7ebjoZoh1yTM6qL3R7g");
  });

  it("dedupes doubled UC prefix and duplicated id tail", () => {
    expect(
      normalizeYoutubeChannelId(
        "UCUC-kilq-ULJHkUXXVdiy_0vwUC-kilq-ULJHkUXXVdiy_0vw",
      ),
    ).toBe("UC-kilq-ULJHkUXXVdiy_0vw");
  });

  it("leaves a plain UC id unchanged", () => {
    const id = "UC-lHJZR3Gqxm24_Vd_AJ5Yw";
    expect(normalizeYoutubeChannelId(id)).toBe(id);
  });
});
