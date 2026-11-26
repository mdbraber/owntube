/**
 * The InnerTube clients OwnTube speaks as. Each identity is sent exactly as
 * that app sends it: host, headers and context together, because YouTube
 * judges them as a whole. Constants mirror NewPipeExtractor's
 * `ClientsConstants.java` and youtubei.js; bump them together.
 */
export interface ClientIdentity {
  /** InnerTube `clientName`. */
  name: string;
  /** Numeric client id (`X-Youtube-Client-Name`, `c=` in stream URLs). */
  id: number;
  version: string;
  host: "www.youtube.com" | "youtubei.googleapis.com";
  userAgent: string;
  /** Extra fields for `context.client`. */
  context: Record<string, string | number>;
  /** Extra request headers. */
  headers: Record<string, string>;
  /** Stream URLs carry a signature or `n` challenge that must be deciphered with the player JS. */
  deciphers: boolean;
}

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36,gzip(gfe)";

export const WEB: ClientIdentity = {
  name: "WEB",
  id: 1,
  version: "2.20261125.00.00",
  host: "www.youtube.com",
  userAgent: CHROME_UA,
  context: { platform: "DESKTOP", clientFormFactor: "UNKNOWN_FORM_FACTOR" },
  headers: {
    origin: "https://www.youtube.com",
    referer: "https://www.youtube.com/",
  },
  deciphers: true,
};

export const MWEB: ClientIdentity = {
  name: "MWEB",
  id: 2,
  version: "2.20261125.01.00",
  host: "www.youtube.com",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1,gzip(gfe)",
  context: { platform: "MOBILE", clientFormFactor: "SMALL_FORM_FACTOR" },
  headers: {
    origin: "https://m.youtube.com",
    referer: "https://m.youtube.com/",
  },
  deciphers: true,
};

export const TV_SIMPLY: ClientIdentity = {
  name: "TVHTML5_SIMPLY",
  id: 74,
  version: "1.0",
  host: "www.youtube.com",
  userAgent:
    "Mozilla/5.0 (PlayStation; PlayStation 4/12.02) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  context: { platform: "TV", clientScreen: "WATCH" },
  headers: {
    origin: "https://www.youtube.com",
    referer: "https://www.youtube.com/tv",
  },
  deciphers: true,
};

/** The living-room (Cobalt) app. */
export const TV: ClientIdentity = {
  name: "TVHTML5",
  id: 7,
  version: "7.20260311.12.00",
  host: "www.youtube.com",
  userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version",
  context: { platform: "TV", clientScreen: "WATCH" },
  headers: {
    origin: "https://www.youtube.com",
    referer: "https://www.youtube.com/tv",
  },
  deciphers: true,
};

/** The Quest 3 app. No PO token; live and post-live DVR manifests. */
export const ANDROID_VR: ClientIdentity = {
  name: "ANDROID_VR",
  id: 28,
  version: "1.65.10",
  host: "www.youtube.com",
  userAgent:
    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  context: {
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    androidSdkVersion: 32,
    osName: "Android",
    osVersion: "12L",
  },
  headers: {},
  deciphers: false,
};

/**
 * The visionOS app, as NewPipeExtractor's `ofVisionOsClient()` sends it. No PO
 * token, and (2026-09-23) the only identity the SABR server lets start
 * mid-video.
 */
export const VISIONOS: ClientIdentity = {
  name: "VISIONOS",
  id: 101,
  version: "1.04",
  host: "youtubei.googleapis.com",
  userAgent:
    "com.google.visionos.youtube/1.04(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; US)",
  context: {
    clientScreen: "WATCH",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
    osName: "visionOS",
    osVersion: "26.6.0.23O770",
  },
  headers: { "x-goog-api-format-version": "2" },
  deciphers: false,
};

export const CLIENTS = {
  WEB,
  MWEB,
  TV,
  TV_SIMPLY,
  ANDROID_VR,
  VISIONOS,
} as const;
