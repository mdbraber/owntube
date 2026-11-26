import { describe, expect, it } from "vitest";
import type { Exchange } from "./exchange.ts";
import {
  assertScrubbed,
  canonicalIp,
  findSecrets,
  SCRUBBED_IPV4,
  SCRUBBED_IPV6,
  SCRUBBED_VISITOR_DATA,
  scrubExchanges,
} from "./scrub.ts";

const V6 = "2001:0db8:85a3:0:0:8a2e:370:7334"; // a documentation address standing in for ours
const V6_SHORT = "2001:db8:85a3::8a2e:370:7334";
const V4 = "198.51.100.23";
const VISITOR = "CgtBYmNEZWZHaElqSyiAgICABg%3D%3D";

function exchange(
  responseBody: unknown,
  url = "https://www.youtube.com/youtubei/v1/player",
): Exchange {
  return {
    method: "POST",
    url,
    requestBody: {
      context: { client: { visitorData: VISITOR } },
      videoId: "dQw4w9WgXcQ",
    },
    status: 200,
    contentType: "application/json",
    responseBody,
  };
}

describe("canonicalIp", () => {
  it("spells IPv6 one way whatever the input", () => {
    expect(canonicalIp(V6)).toBe(canonicalIp(V6_SHORT));
    expect(canonicalIp(encodeURIComponent(V6_SHORT))).toBe(canonicalIp(V6));
  });

  it("rejects things that are not addresses", () => {
    expect(canonicalIp("10:30")).toBeNull();
    expect(canonicalIp("3")).toBeNull();
  });
});

describe("scrubExchanges", () => {
  const recording = [
    exchange({
      responseContext: { remoteHost: V6, visitorData: VISITOR },
      streamingData: {
        formats: [
          {
            url: `https://rr1.googlevideo.com/videoplayback?ip=${encodeURIComponent(V6_SHORT)}&fvip=3&itag=18`,
          },
          { url: `https://rr2.googlevideo.com/videoplayback/ip/${V4}/itag/22` },
        ],
      },
    }),
    exchange(
      `)]}'\n[["yt.sw.adr",null,[[["en","NL",null,"${V6}",null,"${VISITOR}"]]]]]`,
      "https://www.youtube.com/sw.js_data",
    ),
  ];

  it("finds our addresses and visitor data", () => {
    const { ips, visitorData } = findSecrets(recording);
    expect([...ips].sort()).toEqual([canonicalIp(V6), V4].sort());
    expect(visitorData).toEqual([VISITOR]);
  });

  it("replaces every spelling and encoding", () => {
    const text = JSON.stringify(scrubExchanges(recording));
    expect(text).not.toContain("2001:0db8:85a3");
    expect(text).not.toContain("2001:db8:85a3");
    expect(text).not.toContain("2001%3Adb8%3A85a3");
    expect(text).not.toContain(V4);
    expect(text).not.toContain(VISITOR);
    expect(text).toContain(SCRUBBED_IPV6);
    expect(text).toContain(encodeURIComponent(SCRUBBED_IPV6));
    expect(text).toContain(SCRUBBED_IPV4);
    expect(text).toContain(SCRUBBED_VISITOR_DATA);
  });

  it("leaves unrelated numbers alone", () => {
    expect(JSON.stringify(scrubExchanges(recording))).toContain(
      "fvip=3&itag=18",
    );
  });

  it("does not mistake a version number for the address", () => {
    const ua = [
      exchange({
        userAgent: `Chrome/1${V4}.40 Safari/537.36`,
        ip: `https://x/videoplayback?ip=${V4}`,
      }),
    ];
    expect(() => scrubExchanges(ua)).not.toThrow();
  });

  it("refuses output where an address survived", () => {
    const leaky = [exchange({ note: V6 })];
    expect(() =>
      assertScrubbed(leaky, new Set([canonicalIp(V6) as string]), []),
    ).toThrow(/address survived/);
  });
});
