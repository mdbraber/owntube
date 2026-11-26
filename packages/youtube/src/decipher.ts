import { runInNewContext } from "node:vm";
import { Platform, Player, type Types } from "youtubei.js";

/**
 * youtubei.js leaves running YouTube's player JS (signature and `n`
 * functions) to the host. It runs here in a fresh V8 context with no access
 * to our globals, and with a time limit.
 */
export function evaluatePlayerScript(
  data: Types.BuildScriptResult,
  env: Record<string, Types.VMPrimative>,
) {
  const calls: string[] = [];
  if (env.n)
    calls.push(`n: exportedVars.nFunction(${JSON.stringify(String(env.n))})`);
  if (env.sig)
    calls.push(
      `sig: exportedVars.sigFunction(${JSON.stringify(String(env.sig))})`,
    );
  const code = `(function () {\n${data.output}\nreturn { ${calls.join(", ")} };\n})()`;
  return runInNewContext(code, Object.create(null), {
    timeout: 2_000,
  }) as Record<string, string>;
}

let installed = false;

function installEvaluator(): void {
  if (installed) return;
  Platform.shim.eval = evaluatePlayerScript;
  installed = true;
}

/** Loads YouTube's current player JS: its signature timestamp and decipher functions. */
export async function loadPlayer(
  fetch: typeof globalThis.fetch,
): Promise<Player> {
  installEvaluator();
  return Player.create(undefined, fetch);
}
