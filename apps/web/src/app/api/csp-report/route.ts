import { parseCspReport } from "@/lib/content-security-policy";
import { logger } from "@/lib/logger";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * Browsers post Content-Security-Policy violations here (see
 * content-security-policy.ts). Each is logged as `csp.violation` with the
 * directive, the blocked URL and the page path: a Google image the browser
 * refused, or a media/fetch origin the report-only policy would block.
 */
export async function POST(request: Request): Promise<Response> {
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) {
    return new Response(null, { status: 204 });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }
  for (const v of parseCspReport(json) ?? []) {
    logger.warn("csp.violation", v);
  }
  return new Response(null, { status: 204 });
}
