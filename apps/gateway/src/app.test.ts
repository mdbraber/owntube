import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

describe("gateway app", () => {
  it("answers the liveness probe", async () => {
    const res = await createApp().request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 404 for unknown paths", async () => {
    const res = await createApp().request("/nope");
    expect(res.status).toBe(404);
  });
});
