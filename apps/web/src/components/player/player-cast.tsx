"use client";

import { useEffect, useState } from "react";
import {
  AirPlayIcon,
  CastIcon,
  TvIcon,
} from "@/components/player/player-icons";
import type { PlayerAdapter } from "@/components/player/player-types";
import { useActionToast } from "@/components/videos/action-toast";
import {
  CAST_FLAVOR_LABEL,
  type CastFlavor,
  castFlavor,
} from "@/lib/cast-flavor";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/react";

/** Why a disabled cast row is disabled (see `castButtonState`). */
export const CAST_UNAVAILABLE_REASON =
  "This stream can't be sent to a TV from this browser.";

type OwnTubeTv = { deviceId: string; name: string };

/**
 * The icon viewers know for this browser's casting: AirPlay in Safari, Cast
 * in Chrome. With only OwnTube TVs on offer, the Cast icon — what YouTube and
 * Android use for "send to a TV".
 */
function SystemCastIcon({
  flavor,
  connected,
  className,
}: {
  flavor: CastFlavor;
  connected: boolean;
  className?: string;
}) {
  return flavor === "airplay" ? (
    <AirPlayIcon className={className} />
  ) : (
    <CastIcon className={className} connected={connected} />
  );
}

/**
 * The viewer's OwnTube TV apps that are on right now (each polls
 * `tvRemote.poll`), and sending this video to one: from the current position,
 * pausing it here. The TV app plays it with its own player — no browser
 * casting involved — so it's offered first.
 */
function useOwnTubeTvs(
  adapter: PlayerAdapter,
  videoId: string,
  enabled: boolean,
) {
  const devices = trpc.tvRemote.devices.useQuery(undefined, {
    enabled,
    refetchInterval: 15_000,
  });
  const send = trpc.tvRemote.sendToDevice.useMutation();
  const { showToast } = useActionToast();
  const tvs: OwnTubeTv[] = enabled ? (devices.data ?? []) : [];
  const playOn = (tv: OwnTubeTv) => {
    const at = adapter.currentTime;
    send.mutate(
      {
        deviceId: tv.deviceId,
        videoId,
        startSeconds:
          Number.isFinite(at) && at > 5 ? Math.floor(at) : undefined,
      },
      {
        onSuccess: ({ ok }) => {
          if (!ok) {
            showToast(`${tv.name} is no longer on`);
            return;
          }
          adapter.pause();
          showToast(`Playing on ${tv.name}`);
        },
        onError: () => showToast("Couldn't reach the TV"),
      },
    );
  };
  return { tvs, playOn, pending: send.isPending };
}

type TvTargetsProps = {
  adapter: PlayerAdapter;
  videoId: string;
  /** Signed in: only then are there OwnTube TVs to list. */
  isAuthed: boolean;
};

/**
 * The one "Play on a TV" button in the control row: the viewer's OwnTube TVs
 * first, then AirPlay / Cast for any other receiver. Hidden when there's
 * neither. With OwnTube TVs it opens a menu (so a stray tap doesn't start the
 * video on a TV); with only AirPlay / Cast it opens the system picker at once.
 */
export function TvButton({ adapter, videoId, isAuthed }: TvTargetsProps) {
  const { tvs, playOn, pending } = useOwnTubeTvs(adapter, videoId, isAuthed);
  const [open, setOpen] = useState(false);
  const cast = adapter.castButton;
  if (tvs.length === 0 && cast === "hidden") return null;
  const flavor: CastFlavor = cast === "hidden" ? "cast" : castFlavor();
  const icon = (
    <SystemCastIcon
      flavor={flavor}
      connected={adapter.castActive}
      className="h-5 w-5"
    />
  );

  const label = adapter.castActive ? "Playing on a TV" : "Play on a TV";
  const buttonClass = cn(
    "flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/15",
    adapter.castActive ? "bg-white/15 text-[hsl(var(--primary))]" : "",
  );

  if (tvs.length === 0) {
    if (cast === "unavailable") {
      return (
        <button
          type="button"
          disabled
          title={CAST_UNAVAILABLE_REASON}
          aria-label={CAST_UNAVAILABLE_REASON}
          className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full opacity-40"
        >
          {icon}
        </button>
      );
    }
    return (
      <button
        type="button"
        // The picker needs the click's user gesture: call it synchronously.
        onClick={adapter.showCastPicker}
        className={buttonClass}
        title={label}
        aria-label={label}
      >
        {icon}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className={buttonClass}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-50 mb-2 w-60 rounded-xl border border-white/10 bg-zinc-950/95 py-1 text-sm text-zinc-100 shadow-lg backdrop-blur-md"
        >
          <TvTargetRows
            tvs={tvs}
            cast={cast}
            castActive={adapter.castActive}
            onPlayOn={(tv) => {
              setOpen(false);
              playOn(tv);
            }}
            onCast={() => {
              setOpen(false);
              adapter.showCastPicker();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The same targets, as rows in the mobile ⋯ sheet. */
export function TvMenuItems({
  onClose,
  ...props
}: TvTargetsProps & { onClose: () => void }) {
  const { adapter, videoId, isAuthed } = props;
  const { tvs, playOn } = useOwnTubeTvs(adapter, videoId, isAuthed);
  if (tvs.length === 0 && adapter.castButton === "hidden") return null;
  return (
    <TvTargetRows
      tvs={tvs}
      cast={adapter.castButton}
      castActive={adapter.castActive}
      onPlayOn={(tv) => {
        onClose();
        playOn(tv);
      }}
      onCast={() => {
        adapter.showCastPicker();
        onClose();
      }}
    />
  );
}

/** Whether the mobile sheet has any TV rows to show. */
export function useHasTvTargets(props: TvTargetsProps): boolean {
  const { tvs } = useOwnTubeTvs(props.adapter, props.videoId, props.isAuthed);
  return tvs.length > 0 || props.adapter.castButton !== "hidden";
}

function TvTargetRows({
  tvs,
  cast,
  castActive,
  onPlayOn,
  onCast,
}: {
  tvs: OwnTubeTv[];
  cast: PlayerAdapter["castButton"];
  castActive: boolean;
  onPlayOn: (tv: OwnTubeTv) => void;
  onCast: () => void;
}) {
  const row =
    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left";
  const flavor = castFlavor();
  const name = CAST_FLAVOR_LABEL[flavor];
  return (
    <>
      {tvs.map((tv) => (
        <button
          key={tv.deviceId}
          type="button"
          role="menuitem"
          className={cn(row, "hover:bg-white/10")}
          onClick={() => onPlayOn(tv)}
        >
          <span>Play on {tv.name}</span>
          <TvIcon className="h-4 w-4 text-zinc-400" />
        </button>
      ))}
      {cast === "castable" ? (
        <button
          type="button"
          role="menuitem"
          className={cn(row, "hover:bg-white/10")}
          // Synchronous: the picker needs this click's user gesture.
          onClick={onCast}
        >
          <span>{name}…</span>
          <span
            className={cn(
              "text-xs",
              castActive ? "text-[hsl(var(--primary))]" : "text-zinc-400",
            )}
          >
            {castActive ? (
              "Connected"
            ) : (
              <SystemCastIcon
                flavor={flavor}
                connected={false}
                className="h-4 w-4"
              />
            )}
          </span>
        </button>
      ) : cast === "unavailable" ? (
        <button
          type="button"
          role="menuitem"
          disabled
          className={cn(row, "cursor-not-allowed text-zinc-500")}
          title={CAST_UNAVAILABLE_REASON}
        >
          <span>{name}</span>
          <span className="text-xs">Unavailable</span>
        </button>
      ) : null}
    </>
  );
}

/**
 * Says so, for a few seconds after casting starts, when the sound stays on
 * this device (split playback's separate audio, or audio already routed
 * through the peak limiter) — otherwise the TV is just silent.
 */
export function CastAudioNotice({ adapter }: { adapter: PlayerAdapter }) {
  const audioStaysHere = adapter.castActive && adapter.castAudioStaysLocal;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(audioStaysHere);
    if (!audioStaysHere) return;
    const t = setTimeout(() => setShown(false), 6000);
    return () => clearTimeout(t);
  }, [audioStaysHere]);
  if (!shown) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-40 flex justify-center px-4">
      {/* biome-ignore lint/a11y/useSemanticElements: transient status text, not a form/alert widget */}
      <div
        role="status"
        className="max-w-[90%] rounded-full bg-black/80 px-4 py-2 text-center text-xs text-white shadow-lg sm:text-sm"
      >
        The picture is on the TV; the sound for this video stays on this device.
      </div>
    </div>
  );
}
