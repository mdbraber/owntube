"use client";

/** A gateway playback URL: reloading the page signs a fresh one. */
export function shouldAutoRecoverPlaybackSource(src: string): boolean {
  return src.includes("/media/v/");
}

const RECOVERY_ATTEMPT_WINDOW_MS = 5 * 60_000;
const MAX_RECOVERY_ATTEMPTS = 3;

export function playbackResumeStorageKey(): string {
  if (typeof window === "undefined") return "ot:playback-resume:";
  return `ot:playback-resume:${window.location.pathname}`;
}

export function tryOneShotPlaybackRecovery(
  recoveryKey: string,
  videoId?: string,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storageKey = videoId
      ? `ot:playback-recover:${videoId}:${recoveryKey}`
      : `ot:playback-recover:${recoveryKey}`;
    const now = Date.now();
    const stateRaw = window.sessionStorage.getItem(storageKey);
    const [lastStr, countStr] = stateRaw ? stateRaw.split(":") : [];
    const last = lastStr ? Number.parseInt(lastStr, 10) : 0;
    const prevCount = countStr ? Number.parseInt(countStr, 10) : 0;
    const withinWindow =
      Number.isFinite(last) && now - last < RECOVERY_ATTEMPT_WINDOW_MS;
    const nextCount = withinWindow ? prevCount + 1 : 1;

    // Avoid infinite loops if upstream keeps failing continuously.
    if (nextCount > MAX_RECOVERY_ATTEMPTS) return false;
    window.sessionStorage.setItem(storageKey, `${now}:${nextCount}`);

    const media = document.querySelector("video");
    const currentTime =
      media && Number.isFinite(media.currentTime) ? media.currentTime : 0;
    if (currentTime > 0.5) {
      window.sessionStorage.setItem(
        playbackResumeStorageKey(),
        String(Math.floor(currentTime)),
      );
    }

    const nextUrl = new URL(window.location.href);
    if (currentTime > 0.5) {
      nextUrl.searchParams.set("t", String(Math.floor(currentTime)));
    }
    // Cache-bust app route + upstream URL generation path.
    nextUrl.searchParams.set("_pr", String(now));
    window.location.assign(nextUrl.toString());
    return true;
  } catch {
    return false;
  }
}
