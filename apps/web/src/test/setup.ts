import { vi } from "vitest";

/** Proxy tests stub `fetch`; route tests use the same stub via this bridge. */
vi.mock("@/server/services/upstream-get", () => ({
  upstreamGetText: async (url: string) => {
    const res = await globalThis.fetch(url);
    return {
      status: res.status,
      ok: res.ok,
      text: await res.text(),
    };
  },
}));
