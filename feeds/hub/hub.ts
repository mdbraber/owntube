/**
 * A minimal WebSub hub (https://www.w3.org/TR/websub/).
 *
 * Subscribers (Pocket Casts' servers) POST hub.mode=subscribe|unsubscribe;
 * intent is verified by calling the callback back with a challenge before
 * anything is stored. The publisher (the OwnTube feeds server) POSTs
 * hub.mode=publish with a bearer token and one hub.url per changed feed; the
 * hub then fetches each matching subscription's topic — with that
 * subscription's own credentials, since feeds are per user — and delivers the
 * body to its callback, signed when the subscriber supplied a secret.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Subscription, SubscriptionStore } from "./store.ts";
import { fetchTarget, redact, topicHostname, topicKey } from "./topic.ts";

export const DEFAULT_LEASE_SECONDS = 10 * 86400;
export const MIN_LEASE_SECONDS = 3600;
export const MAX_LEASE_SECONDS = 30 * 86400;

export type HubResult = {
  status: number;
  body: string;
  /** Work to run after the response is sent (verification or delivery). */
  after?: () => Promise<void>;
};

export type HubOptions = {
  store: SubscriptionStore;
  /** This hub's public URL, sent back in delivery Link headers. */
  hubUrl: string;
  publishToken: string;
  /** Hostnames whose topics this hub serves. */
  topicHosts: string[];
  isCallbackAllowed: (callback: string) => Promise<boolean>;
  fetch?: typeof fetch;
  /** Unix seconds. */
  now?: () => number;
  log?: (msg: string) => void;
  /** Waits between delivery attempts; one retry per entry. */
  retryDelaysMs?: number[];
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bearerMatches(header: string | undefined, token: string): boolean {
  const m = (header ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Hub {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly retryDelaysMs: number[];

  constructor(private readonly opts: HubOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.log = opts.log ?? (() => {});
    this.retryDelaysMs = opts.retryDelaysMs ?? [5_000, 30_000, 120_000];
  }

  async handle(form: URLSearchParams, authorization?: string): Promise<HubResult> {
    const mode = form.get("hub.mode");
    if (mode === "subscribe" || mode === "unsubscribe") {
      return this.handleSubscription(mode, form);
    }
    if (mode === "publish") return this.handlePublish(form, authorization);
    return { status: 400, body: "hub.mode must be subscribe, unsubscribe or publish\n" };
  }

  private async handleSubscription(
    mode: "subscribe" | "unsubscribe",
    form: URLSearchParams,
  ): Promise<HubResult> {
    const callback = form.get("hub.callback") ?? "";
    const topic = form.get("hub.topic") ?? "";
    const host = topicHostname(topic);
    if (!host || !topicKey(topic)) {
      return { status: 400, body: "hub.topic must be an http(s) URL\n" };
    }
    if (!this.opts.topicHosts.includes(host)) {
      return { status: 400, body: "topic not served by this hub\n" };
    }
    if (!(await this.opts.isCallbackAllowed(callback))) {
      return { status: 400, body: "hub.callback must be a public http(s) URL\n" };
    }
    const secret = form.get("hub.secret");
    if (secret !== null && Buffer.byteLength(secret) >= 200) {
      return { status: 400, body: "hub.secret must be under 200 bytes\n" };
    }
    const requested = Number.parseInt(form.get("hub.lease_seconds") ?? "", 10);
    const lease = Number.isFinite(requested)
      ? Math.min(MAX_LEASE_SECONDS, Math.max(MIN_LEASE_SECONDS, requested))
      : DEFAULT_LEASE_SECONDS;
    return {
      status: 202,
      body: "accepted\n",
      after: () => this.verifyIntent(mode, callback, topic, secret || null, lease),
    };
  }

  private async verifyIntent(
    mode: "subscribe" | "unsubscribe",
    callback: string,
    topic: string,
    secret: string | null,
    lease: number,
  ): Promise<void> {
    const challenge = randomBytes(16).toString("hex");
    const url = new URL(callback);
    url.searchParams.set("hub.mode", mode);
    url.searchParams.set("hub.topic", topic);
    url.searchParams.set("hub.challenge", challenge);
    if (mode === "subscribe") url.searchParams.set("hub.lease_seconds", String(lease));
    let confirmed = false;
    try {
      const res = await this.fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      confirmed = res.ok && (await res.text()).trim() === challenge;
    } catch (error) {
      this.log(`${mode} verification failed for ${callback}: ${message(error)}`);
    }
    if (!confirmed) {
      this.log(`${mode} NOT confirmed: ${callback} → ${redact(topic)}`);
      return;
    }
    if (mode === "subscribe") {
      this.opts.store.upsert({
        callback,
        topic,
        secret,
        leaseSeconds: lease,
        expiresAt: this.now() + lease,
      });
    } else {
      this.opts.store.remove(callback, topic);
    }
    this.log(`${mode} confirmed: ${callback} → ${redact(topic)}`);
  }

  private handlePublish(form: URLSearchParams, authorization?: string): HubResult {
    if (!bearerMatches(authorization, this.opts.publishToken)) {
      return { status: 401, body: "unauthorized\n" };
    }
    const urls = [...form.getAll("hub.url"), ...form.getAll("hub.topic")];
    const keys = urls.map(topicKey);
    if (urls.length === 0 || keys.some((k) => k === null)) {
      return { status: 400, body: "hub.url must be one or more http(s) URLs\n" };
    }
    return {
      status: 202,
      body: "accepted\n",
      after: async () => {
        this.opts.store.pruneExpired(this.now());
        await Promise.all((keys as string[]).map((k) => this.distribute(k)));
      },
    };
  }

  private async distribute(key: string): Promise<void> {
    const subs = this.opts.store.active(key, this.now());
    await Promise.all(subs.map((s) => this.deliver(s)));
  }

  private async deliver(sub: Subscription): Promise<void> {
    if (!(await this.opts.isCallbackAllowed(sub.callback))) {
      this.log(`skip ${sub.callback}: no longer a public address`);
      return;
    }
    const target = fetchTarget(sub.topic);
    let body: Buffer;
    let contentType: string;
    try {
      const res = await this.fetch(target.url, {
        headers: target.authorization ? { authorization: target.authorization } : {},
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.log(`fetch ${redact(sub.topic)} → ${res.status}; not delivered`);
        return;
      }
      body = Buffer.from(await res.arrayBuffer());
      contentType = res.headers.get("content-type") ?? "application/rss+xml";
    } catch (error) {
      this.log(`fetch ${redact(sub.topic)} failed: ${message(error)}`);
      return;
    }
    const headers: Record<string, string> = {
      "content-type": contentType,
      link: `<${this.opts.hubUrl}>; rel="hub", <${sub.topic}>; rel="self"`,
    };
    if (sub.secret) {
      headers["x-hub-signature"] =
        `sha256=${createHmac("sha256", sub.secret).update(body).digest("hex")}`;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.fetch(sub.callback, {
          method: "POST",
          headers,
          body: body as unknown as BodyInit,
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 410) {
          this.opts.store.remove(sub.callback, sub.topic);
          this.log(`${sub.callback} is gone; unsubscribed`);
          return;
        }
        if (res.ok) {
          this.log(`delivered ${redact(sub.topic)} → ${sub.callback}`);
          return;
        }
        this.log(`deliver to ${sub.callback} → ${res.status}`);
      } catch (error) {
        this.log(`deliver to ${sub.callback} failed: ${message(error)}`);
      }
      if (attempt >= this.retryDelaysMs.length) {
        this.log(`giving up on ${sub.callback} for ${redact(sub.topic)}`);
        return;
      }
      await sleep(this.retryDelaysMs[attempt]);
    }
  }
}
