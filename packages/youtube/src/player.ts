import type { Player } from "youtubei.js";
import type { ClientIdentity } from "./clients.ts";
import {
  classifyPlayability,
  type PlayabilityStatus,
  type Unplayable,
} from "./playability.ts";

/** The parts of a `/player` response OwnTube reads. */
export interface RawFormat {
  itag: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  mimeType: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  qualityLabel?: string;
  contentLength?: string;
  approxDurationMs?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  initRange?: { start: string; end: string };
  indexRange?: { start: string; end: string };
  colorInfo?: { primaries?: string; transferCharacteristics?: string };
  audioTrack?: { id: string; displayName: string; audioIsDefault: boolean };
  isDrc?: boolean;
  xtags?: string;
  /** Identifies the encoding; SABR requests name formats by itag and this. */
  lastModified?: string;
  averageBitrate?: number;
  audioQuality?: string;
  quality?: string;
}

export interface RawCaptionTrack {
  baseUrl: string;
  languageCode: string;
  name?: { simpleText?: string; runs?: Array<{ text: string }> };
  kind?: string;
  vssId?: string;
}

export interface RawPlayerResponse {
  playabilityStatus?: PlayabilityStatus;
  streamingData?: {
    expiresInSeconds?: string;
    formats?: RawFormat[];
    adaptiveFormats?: RawFormat[];
    hlsManifestUrl?: string;
    dashManifestUrl?: string;
    serverAbrStreamingUrl?: string;
  };
  videoDetails?: {
    videoId: string;
    title?: string;
    lengthSeconds?: string;
    isLive?: boolean;
    isLiveContent?: boolean;
    isPostLiveDvr?: boolean;
    isUpcoming?: boolean;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: RawCaptionTrack[] };
  };
  playerConfig?: {
    mediaCommonConfig?: {
      mediaUstreamerRequestConfig?: { videoPlaybackUstreamerConfig?: string };
    };
  };
  microformat?: {
    playerMicroformatRenderer?: {
      liveBroadcastDetails?: { startTimestamp?: string };
    };
  };
}

export interface PlayerRequest {
  videoId: string;
  identity: ClientIdentity;
  visitorData: string;
  /** Loaded player JS; required for identities that decipher. */
  player?: Player;
  poToken?: string;
  /**
   * The token of a SABR reload demand. The next player request must echo it,
   * or the server keeps demanding reloads (companion, 2026-11-20: ten in a row
   * on mjsMqasGhKU until the pull gave up).
   */
  reloadToken?: string;
  hl?: string;
  gl?: string;
}

export interface PlayerResult {
  identity: ClientIdentity;
  raw: RawPlayerResponse;
  unplayable: Unplayable | null;
  /** Adaptive and muxed formats with a usable URL (deciphered where needed). */
  formats: Array<RawFormat & { url: string }>;
}

export function buildPlayerBody(req: PlayerRequest): Record<string, unknown> {
  const { identity } = req;
  return {
    context: {
      client: {
        clientName: identity.name,
        clientVersion: identity.version,
        hl: req.hl ?? "en",
        gl: req.gl ?? "US",
        visitorData: req.visitorData,
        userAgent: identity.userAgent,
        ...identity.context,
      },
    },
    videoId: req.videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS",
        ...(req.player
          ? { signatureTimestamp: req.player.signature_timestamp }
          : {}),
      },
      ...(req.reloadToken
        ? {
            reloadPlaybackContext: {
              reloadPlaybackParams: { token: req.reloadToken },
            },
          }
        : {}),
    },
    racyCheckOk: true,
    contentCheckOk: true,
    ...(req.poToken
      ? { serviceIntegrityDimensions: { poToken: req.poToken } }
      : {}),
  };
}

/** Asks YouTube for a video's player response as `identity`, and resolves its stream URLs. */
export async function requestPlayer(
  req: PlayerRequest,
  fetch: typeof globalThis.fetch,
): Promise<PlayerResult> {
  const { identity } = req;
  if (identity.deciphers && !req.player)
    throw new Error(`${identity.name} needs the player JS`);
  const response = await fetch(
    `https://${identity.host}/youtubei/v1/player?prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": identity.userAgent,
        "x-youtube-client-name": String(identity.id),
        "x-youtube-client-version": identity.version,
        "x-goog-visitor-id": req.visitorData,
        ...identity.headers,
      },
      body: JSON.stringify(buildPlayerBody(req)),
    },
  );
  if (!response.ok)
    throw new Error(`${identity.name} /player: HTTP ${response.status}`);
  const raw = (await response.json()) as RawPlayerResponse;
  const unplayable = classifyPlayability(
    raw.playabilityStatus,
    raw.microformat?.playerMicroformatRenderer?.liveBroadcastDetails
      ?.startTimestamp,
  );
  const all = [
    ...(raw.streamingData?.formats ?? []),
    ...(raw.streamingData?.adaptiveFormats ?? []),
  ];
  const formats: PlayerResult["formats"] = [];
  const nsigCache = new Map<string, string>();
  for (const format of all) {
    const url = await resolveUrl(format, identity, req.player, nsigCache);
    if (url) formats.push({ ...format, url });
  }
  return { identity, raw, unplayable, formats };
}

async function resolveUrl(
  format: RawFormat,
  identity: ClientIdentity,
  player: Player | undefined,
  nsigCache: Map<string, string>,
): Promise<string | undefined> {
  if (!format.url && !format.signatureCipher && !format.cipher)
    return undefined;
  if (!identity.deciphers || !player) return format.url;
  return player.decipher(
    format.url,
    format.signatureCipher,
    format.cipher,
    nsigCache,
  );
}
