/**
 * The hub makes outbound requests to whatever callback a subscriber names.
 * It runs on spiff next to other services, so a callback must resolve only to
 * public addresses — otherwise anyone could make the hub probe the host's
 * private networks. Checked at subscribe time and again before each delivery
 * (DNS can change in between). `publicOnlyFetch` closes a narrower gap: a
 * malicious DNS server could answer the `callbackIsPublic` check with a
 * public address and then answer the real connection with a private one
 * (DNS rebinding), so outbound requests re-check every resolved address at
 * connect time too.
 */
import { promises as dns } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return false;
  // An IPv4-mapped IPv6 address reaches the IPv4 host, so judge that.
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return !blocked.check(mapped[1], "ipv4");
  return !blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

async function lookupAll(host: string): Promise<string[]> {
  const records = await dns.lookup(host, { all: true });
  return records.map((r) => r.address);
}

export async function callbackIsPublic(
  callback: string,
  lookup: (host: string) => Promise<string[]> = lookupAll,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(callback);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : await lookup(host).catch(() => [] as string[]);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

type LookupResolver = (hostname: string) => Promise<LookupAddress[]>;
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

async function defaultResolve(hostname: string): Promise<LookupAddress[]> {
  return dns.lookup(hostname, { all: true });
}

/**
 * A `node:net` `lookup`-compatible function: resolves `hostname` and fails
 * if ANY resolved address is not public. `callbackIsPublic` checks a
 * callback's hostname before the hub ever connects to it, but `fetch`
 * resolves the name again to actually connect — a DNS server could answer
 * differently the second time (DNS rebinding) and hand the hub a private
 * address to connect to. Passing this as the `lookup` used for the
 * connection closes that gap by enforcing the same rule at connect time.
 * The resolver is injectable for testing; it defaults to `dns.lookup`.
 */
export function publicOnlyLookup(
  resolve: LookupResolver = defaultResolve,
): (hostname: string, options: LookupOptions, callback: LookupCallback) => void {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(new Error(`no addresses found for ${hostname}`), "");
          return;
        }
        if (!addresses.every((a) => isPublicAddress(a.address))) {
          callback(new Error(`${hostname} resolved to a non-public address`), "");
          return;
        }
        if (options?.all === true) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), "");
      },
    );
  };
}

/**
 * `fetch`, but the connection it makes is only ever allowed to reach a
 * public address — see `publicOnlyLookup`. Note: `net.connect` does not call
 * `lookup` for IP-literal hosts (e.g. `http://10.0.0.1/`); those remain
 * covered by `callbackIsPublic`, which `Hub` already calls before every
 * outbound request.
 */
const publicOnlyAgent = new Agent({ connect: { lookup: publicOnlyLookup() } });

export const publicOnlyFetch: typeof fetch = ((
  input: RequestInfo | URL,
  init: RequestInit = {},
) =>
  undiciFetch(input as never, {
    ...(init as Record<string, unknown>),
    dispatcher: publicOnlyAgent,
  } as never) as unknown as Promise<Response>) as typeof fetch;
