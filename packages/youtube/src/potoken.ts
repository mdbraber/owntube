import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { getChallenge } from "bgutils-js/botguard";
import { buildURL, GOOG_API_KEY } from "bgutils-js/utils";
import { type Browser, chromium, type Page } from "playwright-core";

/**
 * Mints PO tokens: proof to YouTube that a real browser vouches for a visitor
 * or a video. Only needed when YouTube demands attestation, which no client
 * OwnTube uses needed on 2026-11-26; this is the third transport step.
 */
export interface PoTokenProvider {
  /** A token bound to `binding` (visitor data for a session token, a video id for a content token). */
  mint(binding: string): Promise<string>;
  close(): Promise<void>;
}

/** The BotGuard request key for YouTube's web PO tokens. */
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const PAGE_URL = "https://www.youtube.com/";
const LIB_PREFIX = `${PAGE_URL}__owntube_bgutils/`;

export interface BrowserMinterOptions {
  /** Chromium (or chrome-headless-shell) to run BotGuard in. */
  executablePath: string;
  /** Egress fetch for the challenge and the integrity token (the browser itself makes no requests). */
  fetch: typeof globalThis.fetch;
  userAgent: string;
  /** The browser is closed after this long without a mint (default 10 min). */
  idleMs?: number;
  now?: () => number;
}

interface Minter {
  page: Page;
  expiresAt: number;
}

/**
 * Runs BotGuard in a headless browser started only when a token is needed,
 * and closes it again when idle. The page is a blank youtube.com page whose
 * every request is blocked except bgutils-js (MIT, LuanRT/BgUtils), served
 * from disk: BotGuard runs in a real browser, but only this process talks to
 * the network.
 */
export class BrowserPoTokenMinter implements PoTokenProvider {
  readonly #o: BrowserMinterOptions;
  readonly #now: () => number;
  #browser: Promise<Browser> | undefined;
  #minter: Promise<Minter> | undefined;
  #idle: NodeJS.Timeout | undefined;

  constructor(options: BrowserMinterOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
  }

  async mint(binding: string): Promise<string> {
    this.#touch();
    let minter = await this.#ensureMinter();
    if (this.#now() >= minter.expiresAt) {
      this.#minter = undefined;
      minter = await this.#ensureMinter();
    }
    return minter.page.evaluate(
      (b) =>
        (
          globalThis as unknown as {
            __owntubeMint: (b: string) => Promise<string>;
          }
        ).__owntubeMint(b),
      binding,
    );
  }

  async close(): Promise<void> {
    clearTimeout(this.#idle);
    const browser = this.#browser;
    this.#browser = undefined;
    this.#minter = undefined;
    await (await browser?.catch(() => undefined))?.close();
  }

  #touch(): void {
    clearTimeout(this.#idle);
    this.#idle = setTimeout(
      () => void this.close(),
      this.#o.idleMs ?? 10 * 60_000,
    );
    this.#idle.unref();
  }

  #ensureMinter(): Promise<Minter> {
    this.#minter ??= this.#createMinter();
    this.#minter.catch(() => {
      this.#minter = undefined;
    });
    return this.#minter;
  }

  async #createMinter(): Promise<Minter> {
    this.#browser ??= chromium.launch({
      executablePath: this.#o.executablePath,
      headless: true,
    });
    const browser = await this.#browser;
    const page = await browser.newPage({ userAgent: this.#o.userAgent });
    const libDir = bgutilsDist();
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url === PAGE_URL)
        return route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html><body></body></html>",
        });
      if (url.startsWith(LIB_PREFIX)) {
        const file = path.join(
          libDir,
          url.slice(LIB_PREFIX.length).split("?")[0] as string,
        );
        if (!file.startsWith(libDir)) return route.abort("blockedbyclient");
        return route.fulfill({
          contentType: "text/javascript",
          body: await readFile(file, "utf8"),
        });
      }
      return route.abort("blockedbyclient");
    });
    await page.goto(PAGE_URL);

    // The challenge and the interpreter come through our egress, not the browser.
    const challenge = await getChallenge({
      requestKey: REQUEST_KEY,
      fetchFunction: this.#o.fetch,
      useYouTubeAPI: true,
    });
    let interpreter =
      challenge.interpreterJavascript
        ?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    const interpreterUrl =
      challenge.interpreterUrl
        ?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (!interpreter && interpreterUrl) {
      const res = await this.#o.fetch(new URL(interpreterUrl, PAGE_URL), {
        headers: { "user-agent": this.#o.userAgent },
      });
      if (!res.ok) throw new Error(`potoken: interpreter ${res.status}`);
      interpreter = await res.text();
    }
    if (!interpreter || !challenge.program || !challenge.globalName)
      throw new Error("potoken: incomplete challenge");

    const botguardResponse = await page.evaluate(
      async ({ interpreter, program, globalName, lib }) => {
        new Function(interpreter)();
        const { BotGuardClient } = await import(`${lib}exports/botguard.js`);
        const client = await BotGuardClient.create({
          program,
          globalName,
          globalObject: globalThis,
        });
        const signals: unknown[] = [];
        (
          globalThis as unknown as { __owntubeSignals: unknown[] }
        ).__owntubeSignals = signals;
        return (await client.snapshot({
          webPoSignalOutput: signals,
        })) as string;
      },
      {
        interpreter,
        program: challenge.program,
        globalName: challenge.globalName,
        lib: LIB_PREFIX,
      },
    );

    const res = await this.#o.fetch(buildURL("GenerateIT", true), {
      method: "POST",
      headers: {
        "content-type": "application/json+protobuf",
        "x-goog-api-key": GOOG_API_KEY,
        "x-user-agent": "grpc-web-javascript/0.1",
        "user-agent": this.#o.userAgent,
      },
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    });
    if (!res.ok) throw new Error(`potoken: GenerateIT ${res.status}`);
    const [integrityToken, ttlSecs] = (await res.json()) as [string, number?];
    if (typeof integrityToken !== "string")
      throw new Error("potoken: no integrity token");

    await page.evaluate(
      async ({ integrityToken, lib }) => {
        const { WebPoMinter } = await import(`${lib}exports/webpo.js`);
        const g = globalThis as unknown as {
          __owntubeSignals: never[];
          __owntubeMint: (b: string) => Promise<string>;
        };
        const minter = await WebPoMinter.create(
          { integrityToken },
          g.__owntubeSignals,
        );
        g.__owntubeMint = (binding: string) =>
          minter.mintAsWebsafeString(binding);
      },
      { integrityToken, lib: LIB_PREFIX },
    );
    // Renew a little before YouTube's estimate runs out.
    return {
      page,
      expiresAt: this.#now() + Math.max(60, (ttlSecs ?? 3600) - 300) * 1000,
    };
  }
}

/** The directory of bgutils-js's ESM build (served to the page). */
function bgutilsDist(): string {
  const require = createRequire(import.meta.url);
  return path.dirname(path.dirname(require.resolve("bgutils-js/utils")));
}
