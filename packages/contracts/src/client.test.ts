import { describe, expect, it } from "vitest";
import { createGatewayClient, GatewayError, isNotCached } from "./client.ts";

const summary = {
  videoId: "dQw4w9WgXcQ",
  title: "t",
  thumbnails: [],
  live: "none",
  isShort: false,
};

function stub(answer: (url: URL) => { status: number; body: unknown }) {
  const seen: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    seen.push(request);
    const { status, body } = answer(new URL(request.url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, seen };
}

describe("createGatewayClient", () => {
  it("sends the key and builds the query", async () => {
    const { fetch, seen } = stub(() => ({
      status: 200,
      body: { videos: [summary], channels: [], playlists: [] },
    }));
    const client = createGatewayClient({
      baseUrl: "http://gw:8080/",
      apiKey: "K",
      fetch,
    });
    const result = await client.search("lofi hip hop", {
      uploadDate: "week",
      continuation: "TOKEN",
    });
    expect(result.videos[0]?.videoId).toBe("dQw4w9WgXcQ");
    expect(seen[0]?.url).toBe(
      "http://gw:8080/api/search?q=lofi+hip+hop&date=week&continuation=TOKEN",
    );
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer K");
  });

  it("rejects answers that do not match the model", async () => {
    const { fetch } = stub(() => ({
      status: 200,
      body: { videos: [{ videoId: 1 }] },
    }));
    await expect(
      createGatewayClient({ baseUrl: "http://gw", apiKey: "K", fetch }).search(
        "x",
      ),
    ).rejects.toThrow();
  });

  it("turns gateway errors into GatewayError with the reason", async () => {
    const { fetch } = stub(() => ({
      status: 502,
      body: { error: "upstream", reason: "YouTube said no" },
    }));
    const error = await createGatewayClient({
      baseUrl: "http://gw",
      apiKey: "K",
      fetch,
    })
      .video("dQw4w9WgXcQ")
      .catch((e) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/YouTube said no/);
  });

  it("asks for cache-only answers and recognises a miss", async () => {
    const { fetch, seen } = stub(() => ({
      status: 404,
      body: { error: "not cached" },
    }));
    const error = await createGatewayClient({
      baseUrl: "http://gw",
      apiKey: "K",
      fetch,
    })
      .channel("UCuAXFkgsw1L7xaCfnd5JJOw", { tab: "shorts", cache: "only" })
      .catch((e) => e);
    expect(seen[0]?.url).toBe(
      "http://gw/api/channel/UCuAXFkgsw1L7xaCfnd5JJOw?tab=shorts&cache=only",
    );
    expect(isNotCached(error)).toBe(true);
  });
});
