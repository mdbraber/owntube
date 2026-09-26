/**
 * The hub makes outbound requests to whatever callback a subscriber names.
 * It runs on spiff next to other services, so a callback must resolve only to
 * public addresses — otherwise anyone could make the hub probe the host's
 * private networks. Checked at subscribe time and again before each delivery
 * (DNS can change in between).
 */
import { promises as dns } from "node:dns";
import net from "node:net";

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
