const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

type FailureWindow = { windowStartMs: number; failures: number };

// ponytail: in-memory per-email window — single-process SQLite app, no shared store needed.
const failuresByEmail = new Map<string, FailureWindow>();

function currentWindow(email: string, nowMs: number): FailureWindow {
  const entry = failuresByEmail.get(email);
  if (!entry || nowMs - entry.windowStartMs >= WINDOW_MS) {
    const fresh = { windowStartMs: nowMs, failures: 0 };
    failuresByEmail.set(email, fresh);
    return fresh;
  }
  return entry;
}

/** True when this email has exhausted its failed-login budget for the window. */
export function isLoginThrottled(email: string, nowMs = Date.now()): boolean {
  return currentWindow(email, nowMs).failures >= MAX_FAILURES;
}

export function recordLoginFailure(email: string, nowMs = Date.now()): void {
  currentWindow(email, nowMs).failures += 1;
}

export function clearLoginFailures(email: string): void {
  failuresByEmail.delete(email);
}

export function resetLoginThrottleForTests(): void {
  failuresByEmail.clear();
}
