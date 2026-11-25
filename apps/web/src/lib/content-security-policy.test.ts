import { describe, expect, it } from "vitest";
import {
  enforcedCsp,
  parseCspReport,
  reportOnlyCsp,
} from "@/lib/content-security-policy";

const MEDIA = "https://owntube-media.example";

describe("content security policy", () => {
  it("allows images from this site and its media origin only", () => {
    expect(enforcedCsp(MEDIA)).toBe(
      `img-src 'self' ${MEDIA} data: blob:; report-uri /api/csp-report`,
    );
    expect(enforcedCsp(`${MEDIA}/`)).toContain(`'self' ${MEDIA} data:`);
  });

  it("is self only without a (valid) media origin", () => {
    expect(enforcedCsp(undefined)).toBe(
      "img-src 'self' data: blob:; report-uri /api/csp-report",
    );
    expect(enforcedCsp("https://x.example/path; script-src *")).not.toContain(
      "script-src",
    );
  });

  it("reports media and fetch origins without blocking them", () => {
    expect(reportOnlyCsp(MEDIA)).toBe(
      `media-src 'self' ${MEDIA} blob: data:; connect-src 'self' ${MEDIA}; report-uri /api/csp-report`,
    );
  });
});

describe("parseCspReport", () => {
  it("reads the legacy report-uri body, page as a path", () => {
    expect(
      parseCspReport({
        "csp-report": {
          "document-uri": "https://owntube.example/watch?v=abc",
          "effective-directive": "img-src",
          "blocked-uri": "https://yt3.ggpht.com/x=s88",
        },
      }),
    ).toEqual([
      {
        directive: "img-src",
        blocked: "https://yt3.ggpht.com/x=s88",
        page: "/watch",
      },
    ]);
  });

  it("reads Reporting API bodies", () => {
    expect(
      parseCspReport([
        {
          type: "csp-violation",
          body: {
            documentURL: "https://owntube.example/",
            effectiveDirective: "connect-src",
            blockedURL: "https://www.google.com/x",
          },
        },
        { type: "deprecation", body: {} },
      ]),
    ).toEqual([
      {
        directive: "connect-src",
        blocked: "https://www.google.com/x",
        page: "/",
      },
    ]);
  });

  it("ignores anything else", () => {
    expect(parseCspReport({ foo: 1 })).toBeNull();
    expect(parseCspReport([])).toBeNull();
    expect(parseCspReport("x")).toBeNull();
  });
});
