"use client";

import { useEffect, useState } from "react";
import { AirPlayIcon } from "@/components/player/player-icons";
import type { PlayerAdapter } from "@/components/player/player-types";
import { cn } from "@/lib/utils";

/** Why a disabled cast button is disabled (see `castButtonState`). */
export const CAST_UNAVAILABLE_REASON =
  "This stream can't be sent to a TV from this browser.";

/** The AirPlay / Cast button in the desktop control row. */
export function CastButton({ adapter }: { adapter: PlayerAdapter }) {
  if (adapter.castButton === "hidden") return null;
  if (adapter.castButton === "unavailable") {
    return (
      <button
        type="button"
        disabled
        title={CAST_UNAVAILABLE_REASON}
        aria-label={CAST_UNAVAILABLE_REASON}
        className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full opacity-40"
      >
        <AirPlayIcon className="h-5 w-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      // The picker needs the click's user gesture: call it synchronously.
      onClick={adapter.showCastPicker}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
        adapter.castActive ? "bg-white/15 text-[hsl(var(--primary))]" : "",
      )}
      aria-label={adapter.castActive ? "Playing on a TV" : "Play on a TV"}
    >
      <AirPlayIcon className="h-5 w-5" />
    </button>
  );
}

/** The same, as a row in the mobile ⋯ sheet. */
export function CastMenuItem({
  adapter,
  onClose,
}: {
  adapter: PlayerAdapter;
  onClose: () => void;
}) {
  if (adapter.castButton === "hidden") return null;
  if (adapter.castButton === "unavailable") {
    return (
      <div
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-zinc-500"
        title={CAST_UNAVAILABLE_REASON}
      >
        <span>Play on a TV</span>
        <span className="text-xs">Unavailable</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        adapter.showCastPicker();
        onClose();
      }}
      className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 hover:bg-white/10"
      aria-pressed={adapter.castActive}
    >
      <span>Play on a TV</span>
      <span
        className={cn(
          "text-xs",
          adapter.castActive ? "text-[hsl(var(--primary))]" : "text-zinc-400",
        )}
      >
        {adapter.castActive ? "Connected" : "Connect"}
      </span>
    </button>
  );
}

/**
 * A few seconds of status after casting starts or fails: when the sound stays
 * on this device (live streams cast their own element, and split audio or the
 * peak limiter can't follow it), or when the TV couldn't play the video.
 */
export function CastAudioNotice({ adapter }: { adapter: PlayerAdapter }) {
  const message = adapter.castError
    ? "This video couldn't be sent to the TV."
    : adapter.castActive && adapter.castAudioStaysLocal
      ? "The picture is on the TV; the sound for this video stays on this device."
      : null;
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    setShown(message);
    if (!message) return;
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [message]);
  if (!shown) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-40 flex justify-center px-4">
      {/* biome-ignore lint/a11y/useSemanticElements: transient status text, not a form/alert widget */}
      <div
        role="status"
        className="max-w-[90%] rounded-full bg-black/80 px-4 py-2 text-center text-xs text-white shadow-lg sm:text-sm"
      >
        {shown}
      </div>
    </div>
  );
}
