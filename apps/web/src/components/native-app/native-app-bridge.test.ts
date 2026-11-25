import { describe, expect, it } from "vitest";
import { nativePageTitle } from "@/components/native-app/native-app-bridge";

describe("nativePageTitle", () => {
  it("drops the site name the title template adds", () => {
    expect(nativePageTitle("Trending · owntube")).toBe("Trending");
    expect(nativePageTitle("A · B · owntube")).toBe("A · B");
  });

  it("is empty for the bare default title", () => {
    expect(nativePageTitle("owntube")).toBe("");
  });
});
