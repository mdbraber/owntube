import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
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
