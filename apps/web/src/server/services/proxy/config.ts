import { isUpstreamDisabled } from "@/lib/upstream-base-url";
import {
  normalizePreferredUpstreamInstance,
  normalizeUpstreamInstanceList,
} from "@/lib/upstream-instances";
import { normalizeInvidiousOutboundBase } from "@/server/services/proxy/normalize";
import {
  orderUpstreamCandidates,
  type UpstreamHealthSnapshot,
  upstreamHealthSnapshot,
} from "@/server/services/upstream-health";

export type ProxySourceOverrides = {
  pipedBaseUrl?: string | null;
  invidiousBaseUrl?: string | null;
  pipedBaseUrls?: string[] | null;
  invidiousBaseUrls?: string[] | null;
  preferredPipedBaseUrl?: string | null;
  preferredInvidiousBaseUrl?: string | null;
};

export type UpstreamAvailability = {
  pipedConfigured: boolean;
  invidiousConfigured: boolean;
  anyConfigured: boolean;
};

export function describeUpstreamAvailability(
  overrides?: ProxySourceOverrides,
): UpstreamAvailability {
  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  return {
    pipedConfigured: pipedBases.length > 0,
    invidiousConfigured: invidiousBases.length > 0,
    anyConfigured: pipedBases.length > 0 || invidiousBases.length > 0,
  };
}

/** Resolved Piped/Invidious bases (env + per-user overrides). */
export function resolveEffectiveProxyBases(overrides?: ProxySourceOverrides): {
  pipedBase: string;
  invidiousBase: string;
} {
  return resolveProxyBases(overrides);
}

export type InstanceSourceRow = {
  /** Raw `PIPED_BASE_URL` / `INVIDIOUS_BASE_URL` value from the server environment. */
  envRaw: string | null;
  envUrl: string | null;
  envDisabled: boolean;
  /** Per-account URL saved in Settings (empty = not overriding). */
  profileOverride: string | null;
  /** URL OwnTube actually uses for this upstream. */
  effectiveUrl: string | null;
  urls: string[];
  preferredUrl: string | null;
  health: UpstreamHealthSnapshot[];
};

export type InstanceSourceInfo = {
  piped: InstanceSourceRow;
  invidious: InstanceSourceRow;
};

function readEnvPipedRaw(): string | null {
  const raw = process.env.PIPED_BASE_URL?.trim();
  return raw || null;
}

function readEnvInvidiousRaw(): string | null {
  const raw = process.env.INVIDIOUS_BASE_URL?.trim();
  return raw || null;
}

function readEnvPipedUrl(): string | null {
  return readEnvPipedUrls()[0] ?? null;
}

function readEnvInvidiousUrl(): string | null {
  return readEnvInvidiousUrls()[0] ?? null;
}

function splitConfiguredUrls(raw: string | null): string[] {
  if (!raw || isUpstreamDisabled(raw)) return [];
  return raw
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function readEnvPipedUrls(): string[] {
  return normalizeUpstreamInstanceList(splitConfiguredUrls(readEnvPipedRaw()));
}

function readEnvInvidiousUrls(): string[] {
  return normalizeUpstreamInstanceList(
    splitConfiguredUrls(readEnvInvidiousRaw()),
  ).map(normalizeInvidiousOutboundBase);
}

/** Server env + optional profile overrides — for Settings display. */
export function getInstanceSourceInfo(profile?: {
  pipedBaseUrl?: string;
  invidiousBaseUrl?: string;
  pipedBaseUrls?: string[];
  invidiousBaseUrls?: string[];
  preferredPipedBaseUrl?: string;
  preferredInvidiousBaseUrl?: string;
}): InstanceSourceInfo {
  const profilePipedUrls = normalizeUpstreamInstanceList([
    ...(profile?.pipedBaseUrls ?? []),
    ...(profile?.pipedBaseUrl ? [profile.pipedBaseUrl] : []),
  ]);
  const profileInvUrls = normalizeUpstreamInstanceList([
    ...(profile?.invidiousBaseUrls ?? []),
    ...(profile?.invidiousBaseUrl ? [profile.invidiousBaseUrl] : []),
  ]).map(normalizeInvidiousOutboundBase);
  const overrides =
    profilePipedUrls.length > 0 || profileInvUrls.length > 0
      ? {
          pipedBaseUrls: profilePipedUrls,
          invidiousBaseUrls: profileInvUrls,
          preferredPipedBaseUrl: profile?.preferredPipedBaseUrl,
          preferredInvidiousBaseUrl: profile?.preferredInvidiousBaseUrl,
        }
      : undefined;
  const {
    pipedBases,
    invidiousBases,
    preferredPipedBase,
    preferredInvidiousBase,
  } = resolveProxyBaseCandidates(overrides);

  const pipedEnvRaw = readEnvPipedRaw();
  const invEnvRaw = readEnvInvidiousRaw();

  return {
    piped: {
      envRaw: pipedEnvRaw,
      envUrl:
        pipedEnvRaw && !isUpstreamDisabled(pipedEnvRaw)
          ? readEnvPipedUrl()
          : null,
      envDisabled: Boolean(pipedEnvRaw && isUpstreamDisabled(pipedEnvRaw)),
      profileOverride:
        profilePipedUrls.length > 0 ? profilePipedUrls.join(", ") : null,
      effectiveUrl: pipedBases[0] ?? null,
      urls: pipedBases,
      preferredUrl: preferredPipedBase ?? null,
      health: pipedBases.map((url) => upstreamHealthSnapshot("piped", url)),
    },
    invidious: {
      envRaw: invEnvRaw,
      envUrl:
        invEnvRaw && !isUpstreamDisabled(invEnvRaw)
          ? readEnvInvidiousUrl()
          : null,
      envDisabled: Boolean(invEnvRaw && isUpstreamDisabled(invEnvRaw)),
      profileOverride:
        profileInvUrls.length > 0 ? profileInvUrls.join(", ") : null,
      effectiveUrl: invidiousBases[0] ?? null,
      urls: invidiousBases,
      preferredUrl: preferredInvidiousBase ?? null,
      health: invidiousBases.map((url) =>
        upstreamHealthSnapshot("invidious", url),
      ),
    },
  };
}

export function resolveProxyBaseCandidates(overrides?: ProxySourceOverrides): {
  pipedBases: string[];
  invidiousBases: string[];
  preferredPipedBase?: string;
  preferredInvidiousBase?: string;
} {
  const rawPiped =
    overrides?.pipedBaseUrls && overrides.pipedBaseUrls.length > 0
      ? overrides.pipedBaseUrls
      : overrides?.pipedBaseUrl !== undefined
        ? [overrides.pipedBaseUrl ?? ""]
        : readEnvPipedUrls();
  const rawInvidious =
    overrides?.invidiousBaseUrls && overrides.invidiousBaseUrls.length > 0
      ? overrides.invidiousBaseUrls
      : overrides?.invidiousBaseUrl !== undefined
        ? [overrides.invidiousBaseUrl ?? ""]
        : readEnvInvidiousUrls();

  const pipedBases = normalizeUpstreamInstanceList(rawPiped);
  const invidiousBases = normalizeUpstreamInstanceList(rawInvidious).map(
    normalizeInvidiousOutboundBase,
  );
  const preferredPipedBase = normalizePreferredUpstreamInstance(
    overrides?.preferredPipedBaseUrl ?? undefined,
    pipedBases,
  );
  const preferredInvidiousBase = normalizePreferredUpstreamInstance(
    overrides?.preferredInvidiousBaseUrl ?? undefined,
    invidiousBases,
  );

  return {
    pipedBases: orderUpstreamCandidates(
      "piped",
      pipedBases,
      preferredPipedBase,
    ),
    invidiousBases: orderUpstreamCandidates(
      "invidious",
      invidiousBases,
      preferredInvidiousBase,
    ),
    preferredPipedBase,
    preferredInvidiousBase,
  };
}

export function resolveProxyBases(overrides?: ProxySourceOverrides): {
  pipedBase: string;
  invidiousBase: string;
} {
  const { pipedBases, invidiousBases } = resolveProxyBaseCandidates(overrides);
  return {
    pipedBase: pipedBases[0] ?? "",
    invidiousBase: invidiousBases[0] ?? "",
  };
}
