import { describe, expect, it } from "vitest";
import {
  stripGoogleImageUrls,
  youtubeImageViaInstance,
} from "@/lib/youtube-image-via-instance";

describe("youtubeImageViaInstance", () => {
  it("sends video stills to the thumbnail proxy, without YouTube's query", () => {
    expect(
      youtubeImageViaInstance(
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg?sqp=abc&rs=def",
      ),
    ).toBe("/image/vi/dQw4w9WgXcQ/hq720.jpg");
    expect(
      youtubeImageViaInstance(
        "https://i9.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp",
      ),
    ).toBe("/image/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  });

  it("keeps a storyboard's signature, through the image proxy", () => {
    const sb =
      "https://i.ytimg.com/sb/dQw4w9WgXcQ/storyboard3_L2/M0.jpg?sqp=x&sigh=rs%24y";
    expect(youtubeImageViaInstance(sb)).toBe(
      `/channel-avatar?url=${encodeURIComponent(sb)}`,
    );
  });

  it("sends avatars and banners to the image proxy, protocol-relative too", () => {
    expect(youtubeImageViaInstance("https://yt3.ggpht.com/abc=s88-c-k")).toBe(
      `/channel-avatar?url=${encodeURIComponent("https://yt3.ggpht.com/abc=s88-c-k")}`,
    );
    expect(
      youtubeImageViaInstance("//yt3.googleusercontent.com/banner=w1060"),
    ).toBe(
      `/channel-avatar?url=${encodeURIComponent("https://yt3.googleusercontent.com/banner=w1060")}`,
    );
  });

  it("prefixes the origin it is given (the TV app)", () => {
    expect(
      youtubeImageViaInstance(
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/0.jpg",
        "https://owntube.example",
      ),
    ).toBe("https://owntube.example/image/vi/dQw4w9WgXcQ/0.jpg");
  });

  it("leaves other URLs alone", () => {
    for (const url of [
      "/image/vi/dQw4w9WgXcQ/hq720.jpg",
      "https://invidious.example/vi/dQw4w9WgXcQ/maxres.jpg",
      "https://evilytimg.com/vi/dQw4w9WgXcQ/0.jpg",
      "http://i.ytimg.com/vi/dQw4w9WgXcQ/0.jpg",
      "not a url",
    ]) {
      expect(youtubeImageViaInstance(url)).toBe(url);
    }
  });
});

describe("stripGoogleImageUrls", () => {
  it("moves Google image URLs at any depth, keeping storyboard $M", () => {
    const sb =
      "https://i.ytimg.com/sb/abc/storyboard3_L2/M$M.jpg?sqp=x&sigh=rs%24y";
    const out = stripGoogleImageUrls({
      title: "See https://i.ytimg.com/vi/abc/0.jpg",
      thumbnailUrl: "https://i.ytimg.com/vi/abc/hq720.jpg",
      channelAvatarUrl: "//yt3.ggpht.com/x=s88",
      storyboard: { templateUrl: sb, count: 3 },
      relatedVideos: [{ thumbnailUrl: "https://i9.ytimg.com/vi/def/1.jpg" }],
      publishedAt: new Date(0),
    });
    expect(out.title).toBe("See https://i.ytimg.com/vi/abc/0.jpg");
    expect(out.thumbnailUrl).toBe("/image/vi/abc/hq720.jpg");
    expect(out.channelAvatarUrl).toBe(
      `/channel-avatar?url=${encodeURIComponent("https://yt3.ggpht.com/x=s88")}`,
    );
    expect(out.storyboard.templateUrl).toContain("M$M.jpg");
    expect(
      decodeURIComponent(
        out.storyboard.templateUrl.replace("$M", "2").split("url=")[1] ?? "",
      ),
    ).toBe(sb.replace("$M", "2"));
    expect(out.relatedVideos[0]?.thumbnailUrl).toBe("/image/vi/def/1.jpg");
    expect(out.publishedAt).toBeInstanceOf(Date);
  });

  it("returns the same object when nothing changes", () => {
    const v = { a: [1, "x"], b: { c: "https://example.com/i.jpg" } };
    expect(stripGoogleImageUrls(v)).toBe(v);
  });
});
