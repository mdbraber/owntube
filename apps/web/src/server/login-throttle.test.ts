import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginFailures,
  isLoginThrottled,
  recordLoginFailure,
  resetLoginThrottleForTests,
} from "@/server/login-throttle";

describe("login throttle", () => {
  beforeEach(() => {
    resetLoginThrottleForTests();
  });

  it("allows attempts below the failure budget", () => {
    for (let i = 0; i < 9; i += 1) {
      recordLoginFailure("a@b.c");
    }
    expect(isLoginThrottled("a@b.c")).toBe(false);
  });

  it("throttles after the failure budget is exhausted", () => {
    for (let i = 0; i < 10; i += 1) {
      recordLoginFailure("a@b.c");
    }
    expect(isLoginThrottled("a@b.c")).toBe(true);
    expect(isLoginThrottled("other@b.c")).toBe(false);
  });

  it("resets after the window elapses", () => {
    const start = Date.now();
    for (let i = 0; i < 10; i += 1) {
      recordLoginFailure("a@b.c", start);
    }
    expect(isLoginThrottled("a@b.c", start)).toBe(true);
    expect(isLoginThrottled("a@b.c", start + 15 * 60_000)).toBe(false);
  });

  it("clears failures on successful login", () => {
    for (let i = 0; i < 10; i += 1) {
      recordLoginFailure("a@b.c");
    }
    clearLoginFailures("a@b.c");
    expect(isLoginThrottled("a@b.c")).toBe(false);
  });
});
