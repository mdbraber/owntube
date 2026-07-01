import { afterEach, describe, expect, it } from "vitest";
import { getInstanceSourceInfo } from "@/server/services/proxy";

describe("getInstanceSourceInfo", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("reports env Piped URL when profile override is empty", () => {
    process.env = {
      ...env,
      PIPED_BASE_URL: "https://piped.example",
      INVIDIOUS_BASE_URL: "",
    };
    const info = getInstanceSourceInfo({});
    expect(info.piped.envUrl).toBe("https://piped.example");
    expect(info.piped.effectiveUrl).toBe("https://piped.example");
    expect(info.piped.urls).toEqual(["https://piped.example"]);
    expect(info.invidious.envRaw).toBeNull();
    expect(info.invidious.effectiveUrl).toBeNull();
  });

  it("prefers profile override over env", () => {
    process.env = {
      ...env,
      PIPED_BASE_URL: "https://piped.env",
      INVIDIOUS_BASE_URL: "",
    };
    const info = getInstanceSourceInfo({
      pipedBaseUrl: "https://piped.profile",
    });
    expect(info.piped.envUrl).toBe("https://piped.env");
    expect(info.piped.profileOverride).toBe("https://piped.profile");
    expect(info.piped.effectiveUrl).toBe("https://piped.profile");
    expect(info.piped.urls).toEqual(["https://piped.profile"]);
  });

  it("reports multiple profile overrides and preferred URL", () => {
    process.env = {
      ...env,
      PIPED_BASE_URL: "https://piped.env",
      INVIDIOUS_BASE_URL: "",
    };
    const info = getInstanceSourceInfo({
      pipedBaseUrls: ["https://one.profile", "https://two.profile"],
      preferredPipedBaseUrl: "https://two.profile",
    });
    expect(info.piped.profileOverride).toBe(
      "https://one.profile, https://two.profile",
    );
    expect(info.piped.urls).toEqual([
      "https://two.profile",
      "https://one.profile",
    ]);
    expect(info.piped.preferredUrl).toBe("https://two.profile");
  });
});
