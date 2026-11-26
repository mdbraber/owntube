/**
 * Why YouTube will not play a video, as a type rather than as error text.
 * Mapped from `playabilityStatus`. YouTube distinguishes some cases (bot
 * check, age gate, members-only) only in its reason text and error screen, so
 * this is the one place that reads them; the rest of OwnTube uses `kind`.
 */
export type Unplayable =
  | { kind: "login-required"; reason: string } // "Sign in to confirm you're not a bot", age checks
  | { kind: "bot-check"; reason: string } // the "not a bot" variant of login-required
  | { kind: "age-restricted"; reason: string }
  | { kind: "members-only"; reason: string }
  | { kind: "upcoming"; reason: string; startsAt?: number }
  | { kind: "unavailable"; reason: string } // removed, private, geo-blocked, …
  | { kind: "unplayable"; reason: string }; // the client is refused (e.g. needs a PO token)

export interface PlayabilityStatus {
  status?: string;
  reason?: string;
  messages?: string[];
  errorScreen?: unknown;
  liveStreamability?: {
    liveStreamabilityRenderer?: {
      offlineSlate?: unknown;
      pollDelayMs?: string;
    };
  };
}

export function classifyPlayability(
  p: PlayabilityStatus | undefined,
  startTimestamp?: string,
): Unplayable | null {
  const status = p?.status ?? "ERROR";
  if (status === "OK") return null;
  const reason =
    [p?.reason, ...(p?.messages ?? [])].filter(Boolean).join(" ") || status;
  const screen = JSON.stringify(p?.errorScreen ?? {});
  if (status === "LIVE_STREAM_OFFLINE") {
    const startsAt = startTimestamp ? Date.parse(startTimestamp) : Number.NaN;
    return {
      kind: "upcoming",
      reason,
      ...(Number.isFinite(startsAt) ? { startsAt } : {}),
    };
  }
  if (
    /members-only|MEMBERS_ONLY|members on level|Join this (YouTube )?channel/i.test(
      `${reason} ${screen}`,
    )
  )
    return { kind: "members-only", reason };
  if (status === "LOGIN_REQUIRED") {
    if (/not a bot/i.test(reason)) return { kind: "bot-check", reason };
    if (/age|inappropriate/i.test(`${reason} ${screen}`))
      return { kind: "age-restricted", reason };
    return { kind: "login-required", reason };
  }
  if (status === "UNPLAYABLE") return { kind: "unplayable", reason };
  return { kind: "unavailable", reason };
}
