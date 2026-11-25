/**
 * Where the browser may load images, media and fetches from: this site and its
 * media origin (see media-origin.ts), never Google.
 *
 * OwnTube moves every Google-hosted image onto the instance
 * (youtube-image-via-instance.ts), but a missed code path would still make the
 * browser fetch from Google and tell it what is on screen. `img-src` is
 * enforced, so such an image is refused instead of loaded; `media-src` and
 * `connect-src` are report-only for now, since a missing origin there would
 * stop playback. Every violation is reported to `/api/csp-report`, which logs
 * it (`csp.violation`), so a leak shows up in the log rather than at Google.
 *
 * Only these directives: no `default-src` or `script-src`, which would need
 * nonces for Next's inline scripts.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

function sources(mediaOrigin: string | undefined): string {
  const origins = ["'self'"];
  const media = mediaOrigin?.trim().replace(/\/+$/, "");
  if (media && /^https?:\/\/[^/]+$/i.test(media)) origins.push(media);
  return origins.join(" ");
}

/** The enforced policy: images. */
export function enforcedCsp(mediaOrigin: string | undefined): string {
  return [
    `img-src ${sources(mediaOrigin)} data: blob:`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

/** The report-only policy: media and fetches, to learn before enforcing. */
export function reportOnlyCsp(mediaOrigin: string | undefined): string {
  const self = sources(mediaOrigin);
  return [
    `media-src ${self} blob: data:`,
    `connect-src ${self}`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

export type CspViolation = {
  directive: string;
  blocked: string;
  page: string;
};

/**
 * The parts of a violation report worth logging, from either format: the
 * legacy `report-uri` body (`{"csp-report": {...}}`) or the Reporting API
 * (`[{type: "csp-violation", body: {...}}]`). The page is logged as a path
 * only. Null for anything else.
 */
export function parseCspReport(json: unknown): CspViolation[] | null {
  const pick = (r: Record<string, unknown>): CspViolation => {
    const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
    let page = s("document-uri") || s("documentURL");
    try {
      page = new URL(page).pathname;
    } catch {
      /* keep as is */
    }
    return {
      directive:
        s("effective-directive") ||
        s("effectiveDirective") ||
        s("violated-directive"),
      blocked: (s("blocked-uri") || s("blockedURL")).slice(0, 300),
      page: page.slice(0, 200),
    };
  };
  if (Array.isArray(json)) {
    const out = json
      .filter(
        (x): x is { body: Record<string, unknown> } =>
          !!x &&
          typeof x === "object" &&
          (x as { type?: unknown }).type === "csp-violation" &&
          typeof (x as { body?: unknown }).body === "object",
      )
      .map((x) => pick(x.body));
    return out.length > 0 ? out : null;
  }
  if (json && typeof json === "object") {
    const r = (json as Record<string, unknown>)["csp-report"];
    if (r && typeof r === "object") return [pick(r as Record<string, unknown>)];
  }
  return null;
}
