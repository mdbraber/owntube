import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateMasterPlaylist = vi.fn();
const generateSabrMasterPlaylist = vi.fn();
vi.mock("@/server/services/hls/generate", () => ({
  fetchVideoCaptions: vi.fn(async () => []),
  generateMasterPlaylist: (...a: unknown[]) => generateMasterPlaylist(...a),
  generateMediaPlaylist: vi.fn(),
  generateSubtitlePlaylist: vi.fn(),
}));
vi.mock("@/server/services/hls/sabr", () => ({
  SABR_TRACK_RE: /^[\w-]+$/,
  generateSabrMasterPlaylist: (...a: unknown[]) =>
    generateSabrMasterPlaylist(...a),
  generateSabrMediaPlaylist: vi.fn(),
}));

const { GET } = await import("./[...parts]/route");

const VIDEO = "dQw4w9WgXcQ";
const BYTE_RANGE = "#EXTM3U\n# byte-range\n";
const SABR = "#EXTM3U\n# sabr\n";

async function master(query = ""): Promise<string> {
  const res = await GET(
    new Request(`http://owntube.test/hls/${VIDEO}/master.m3u8${query}`),
    { params: Promise.resolve({ parts: [VIDEO, "master.m3u8"] }) },
  );
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(() => {
  // Local playback set to byte-range only.
  vi.stubEnv("INVIDIOUS_COMPANION_SABR_VOD", "");
  generateMasterPlaylist.mockReset().mockResolvedValue(BYTE_RANGE);
  generateSabrMasterPlaylist.mockReset().mockResolvedValue(SABR);
});

afterEach(() => vi.unstubAllEnvs());

describe("/hls/<id>/master.m3u8?for=cast", () => {
  it("leaves local playback on the configured manifest", async () => {
    expect(await master()).toBe(BYTE_RANGE);
    expect(generateSabrMasterPlaylist).not.toHaveBeenCalled();
  });

  it("gives a TV the SABR manifest whatever local playback uses", async () => {
    expect(await master("?for=cast")).toBe(SABR);
    expect(generateMasterPlaylist).not.toHaveBeenCalled();
  });

  it("falls back to byte-range when SABR has nothing", async () => {
    generateSabrMasterPlaylist.mockResolvedValue(null);
    expect(await master("?for=cast")).toBe(BYTE_RANGE);
  });

  it("falls back to byte-range when the SABR connector fails", async () => {
    generateSabrMasterPlaylist.mockRejectedValue(new Error("companion down"));
    expect(await master("?for=cast")).toBe(BYTE_RANGE);
  });
});
