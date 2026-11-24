"use client";

import { type RefObject, useEffect, useState } from "react";
import { create } from "zustand";
import { qualityLabel } from "@/lib/quality-label";

/**
 * Stats for nerds: what the player is actually doing, for debugging playback.
 * Off by default; once switched on it stays on for every video until switched
 * off (this browser tab only).
 */
export const useStatsForNerds = create<{ on: boolean; toggle: () => void }>()(
  (set) => ({
    on: false,
    toggle: () => set((s) => ({ on: !s.on })),
  }),
);

/** What a playback engine can report beyond the <video> element itself. */
export type EngineStats = {
  /** "hls.js", "dash.js", "Native HLS", … */
  engine: string;
  /** Manifest (or stream) URL the engine loaded. */
  src?: string;
  /** Variant/representation URL, when it says more than the manifest (SABR). */
  renditionUrl?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** Bitrate of the playing rendition. */
  bitrateKbps?: number;
  /** The engine's estimate of the connection's throughput. */
  bandwidthKbps?: number;
  /** "Auto" or "Manual" rendition choice, when the engine has ABR. */
  abr?: string;
};

const sources = new WeakMap<HTMLVideoElement, () => EngineStats>();

/**
 * Lets an engine hook describe itself for the overlay. Returns the unregister
 * function (a no-op if another engine has since registered on the element).
 */
export function registerStatsSource(
  video: HTMLVideoElement,
  read: () => EngineStats,
): () => void {
  sources.set(video, read);
  return () => {
    if (sources.get(video) === read) sources.delete(video);
  };
}

function readEngine(video: HTMLVideoElement, hasAudioEl: boolean): EngineStats {
  const read = sources.get(video);
  if (read) {
    try {
      return read();
    } catch {
      /* an engine mid-teardown: fall through to what the element says */
    }
  }
  return {
    engine: hasAudioEl
      ? "Progressive (separate video + audio)"
      : "Progressive (muxed)",
    src: video.currentSrc,
  };
}

const READY_STATES = [
  "nothing",
  "metadata",
  "current data",
  "future data",
  "enough data",
];

function bufferAhead(video: HTMLVideoElement): number {
  const t = video.currentTime;
  const b = video.buffered;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= t + 0.25 && t <= b.end(i)) return b.end(i) - t;
  }
  return 0;
}

/** The path (and query) of a URL, without the host. */
function shortUrl(url: string | undefined): string {
  if (!url) return "–";
  if (url.startsWith("blob:")) return "blob (MSE)";
  try {
    const u = new URL(url, window.location.href);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function kbps(n: number | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "–";
  return n >= 1000 ? `${(n / 1000).toFixed(2)} Mbps` : `${Math.round(n)} Kbps`;
}

export function statsRows(
  video: HTMLVideoElement,
  shell: HTMLElement,
  videoId: string,
): [string, string][] {
  const e = readEngine(video, Boolean(shell.querySelector("audio")));
  const urls = `${e.src ?? ""} ${e.renditionUrl ?? ""}`;
  const sabr = urls.includes("/sabr");
  const q = video.getVideoPlaybackQuality?.();
  const dpr = window.devicePixelRatio || 1;
  const rendition =
    e.width && e.height
      ? `${qualityLabel(e.width, e.height)} · ${e.width}×${e.height}${e.frameRate ? `@${Math.round(e.frameRate)}` : ""}`
      : "–";
  return [
    ["Video ID", videoId],
    ["Engine", `${e.engine}${sabr ? " · SABR" : ""}`],
    ["Source", shortUrl(e.src)],
    ...(e.renditionUrl
      ? ([["Rendition URL", shortUrl(e.renditionUrl)]] as [string, string][])
      : []),
    [
      "Viewport",
      `${shell.clientWidth}×${shell.clientHeight}${dpr !== 1 ? ` ×${dpr}` : ""}`,
    ],
    [
      "Decoded",
      video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : "–",
    ],
    ["Rendition", `${rendition}${e.abr ? ` (${e.abr})` : ""}`],
    ["Codecs", [e.videoCodec, e.audioCodec].filter(Boolean).join(" / ") || "–"],
    ["Bitrate", kbps(e.bitrateKbps)],
    ["Connection", kbps(e.bandwidthKbps)],
    ["Buffer", `${bufferAhead(video).toFixed(1)} s`],
    [
      "Frames",
      q ? `${q.droppedVideoFrames} dropped of ${q.totalVideoFrames}` : "–",
    ],
    [
      "State",
      `${READY_STATES[video.readyState] ?? video.readyState}${video.paused ? ", paused" : ""} · ${video.playbackRate}×`,
    ],
  ];
}

/** The overlay itself: polls once a second while shown. */
export function StatsForNerdsOverlay({
  shellRef,
  videoId,
}: {
  shellRef: RefObject<HTMLDivElement | null>;
  videoId: string;
}) {
  const on = useStatsForNerds((s) => s.on);
  const toggle = useStatsForNerds((s) => s.toggle);
  const [rows, setRows] = useState<[string, string][]>([]);

  useEffect(() => {
    if (!on) return;
    const tick = () => {
      const shell = shellRef.current;
      const video = shell?.querySelector("video");
      if (shell && video) setRows(statsRows(video, shell, videoId));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [on, shellRef, videoId]);

  if (!on) return null;
  return (
    <div
      // Clicks pass through to the player (play/pause) except on the close button.
      className="pointer-events-none absolute left-3 top-3 z-30 max-w-[calc(100%-1.5rem)] rounded-md bg-black/75 px-3 py-2 font-mono text-[11px] leading-[1.45] text-zinc-100 shadow-lg backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        aria-label="Close stats for nerds"
        className="pointer-events-auto absolute right-1.5 top-1 px-1 text-zinc-400 hover:text-white"
      >
        ×
      </button>
      <table className="border-separate border-spacing-x-0">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="whitespace-nowrap pr-3 align-top text-zinc-400">
                {label}
              </td>
              <td className="max-w-[28rem] truncate pr-4" title={value}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
