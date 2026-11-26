import {
  createGatewayClient,
  type GatewayClient,
} from "@owntube/contracts/client";
import { gatewayConfig } from "@/server/gateway/config";

let client: GatewayClient | undefined;

/** The one gateway client of this process. */
export function gateway(): GatewayClient {
  if (client) return client;
  const config = gatewayConfig();
  client = createGatewayClient({
    baseUrl: config.url,
    apiKey: config.signingKey,
    // Looked up per request, so tests can stub the global.
    fetch: (input, init) => globalThis.fetch(input, init),
  });
  return client;
}

/** Tests replace the client with one backed by a fake fetch. */
export function setGatewayClientForTest(next: GatewayClient | undefined): void {
  client = next;
}
