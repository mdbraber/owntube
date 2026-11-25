import type { NextConfig } from "next";
import { enforcedCsp, reportOnlyCsp } from "./src/lib/content-security-policy";

// NEXT_PUBLIC_MEDIA_BASE_URL is a build arg (see Dockerfile), so it is set when
// these headers are computed.
const MEDIA_ORIGIN = process.env.NEXT_PUBLIC_MEDIA_BASE_URL;

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The browser may load images only from this site and its media origin
  // (never Google); media and fetches are watched report-only. See
  // src/lib/content-security-policy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: enforcedCsp(MEDIA_ORIGIN) },
          {
            key: "Content-Security-Policy-Report-Only",
            value: reportOnlyCsp(MEDIA_ORIGIN),
          },
        ],
      },
    ];
  },
  // Keep the dev-mode indicator (the round "N") out of the bottom nav's way.
  devIndicators: {
    position: "top-right",
  },
  experimental: {
    // Keep the client-side Router Cache warm so re-navigating between pages
    // reuses the already-fetched RSC payload instead of hitting the server
    // every time. Makes tab switching feel instant within the window below.
    staleTimes: {
      dynamic: 180,
      static: 300,
    },
  },
};

export default nextConfig;
