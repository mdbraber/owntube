import type { SVGProps } from "react";

/**
 * Canonical icon per video action verb. Every surface (cards, rows, menus,
 * sheets, swipe underlays, watch page) imports from here so an action always
 * looks the same — previously the player and the card overlay shipped two
 * different thumbs-up glyphs.
 */

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function base(props: IconProps) {
  const { className = "h-4 w-4", ...rest } = props;
  return { className, "aria-hidden": true as const, ...rest };
}

export function LikeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...base(props)}>
      <path d="M9 21h8a2 2 0 0 0 2-1.6l1-5A2 2 0 0 0 18 12h-5l.7-3.3A2 2 0 0 0 11.8 6L9 9v12ZM4 10h3v11H4z" />
    </svg>
  );
}

export function DislikeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...base(props)}>
      <path d="M15 3H7a2 2 0 0 0-2 1.6l-1 5A2 2 0 0 0 6 12h5l-.7 3.3A2 2 0 0 0 12.2 18L15 15V3Zm5 1h-3v11h3z" />
    </svg>
  );
}

export function QueueIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...base(props)}
    >
      <path d="M4 6h11M4 12h11M4 18h7M17 15v6M20 18h-6" />
    </svg>
  );
}

export function QueuedIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...base(props)}
    >
      <path d="M4 6h11M4 12h11M4 18h7M15 18l2 2 4-4" />
    </svg>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      {...base(props)}
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function SavedIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...base(props)}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function WatchedIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...base(props)}
    >
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function IgnoreIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      {...base(props)}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

export function BlockChannelIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      {...base(props)}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4.5 6l15 12" />
    </svg>
  );
}

export function PlaylistIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      {...base(props)}
    >
      <path d="M4 6h16M4 12h10M4 18h6M17 10v8M13 14h8" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...base(props)}
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      {...base(props)}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...base(props)}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

export function DragHandleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...base(props)}>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}
