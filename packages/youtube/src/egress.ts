import { Agent, type Dispatcher, ProxyAgent } from "undici";

/**
 * The single way out to YouTube. Every request the gateway sends goes through
 * an `Egress`, so the source address, proxy and timeouts are decided in one
 * place. Callers keep `redirect` and `signal` (they are passed through, not
 * dropped).
 */
export interface Egress {
  /** `fetch` that leaves from `localAddress` (or the default route when omitted). */
  fetch(localAddress?: string): typeof globalThis.fetch;
  close(): Promise<void>;
}

export interface EgressOptions {
  /** `http://host:port` of an outbound proxy; local addresses are then ignored. */
  proxyUrl?: string;
  /** Connect timeout and idle-body timeout per request. */
  timeoutMs?: number;
  /** Agents (one per local address) kept for reuse before the least recently used is closed. */
  maxAgents?: number;
}

export function createEgress(options: EgressOptions = {}): Egress {
  const timeout = options.timeoutMs ?? 15_000;
  const maxAgents = options.maxAgents ?? 64;
  const proxy = options.proxyUrl
    ? new ProxyAgent({
        uri: options.proxyUrl,
        connectTimeout: timeout,
        bodyTimeout: timeout,
        headersTimeout: timeout,
      })
    : undefined;
  // Insertion order doubles as recency: a hit is re-inserted at the end.
  const agents = new Map<string, Agent>();

  function dispatcherFor(localAddress: string | undefined): Dispatcher {
    if (proxy) return proxy;
    const key = localAddress ?? "";
    const existing = agents.get(key);
    if (existing) {
      agents.delete(key);
      agents.set(key, existing);
      return existing;
    }
    const agent = new Agent({
      connect: { timeout, ...(localAddress ? { localAddress } : {}) },
      bodyTimeout: timeout,
      headersTimeout: timeout,
    });
    agents.set(key, agent);
    if (agents.size > maxAgents) {
      const [oldestKey, oldest] = agents.entries().next().value as [
        string,
        Agent,
      ];
      agents.delete(oldestKey);
      void oldest.close();
    }
    return agent;
  }

  return {
    fetch(localAddress) {
      const dispatcher = dispatcherFor(localAddress);
      // Node's fetch is undici's; it takes the dispatcher from the init.
      return (input, init) => globalThis.fetch(input, { ...init, dispatcher });
    },
    async close() {
      await Promise.all([...agents.values()].map((a) => a.close()));
      agents.clear();
      await proxy?.close();
    },
  };
}
