"use client";

import { useState } from "react";
import { useInvidiousOrigins } from "@/components/videos/invidious-origin-context";
import { gradientForChannelId, initialsFromLabel } from "@/lib/channel-avatar";
import { toBrowserChannelAvatarUrl } from "@/lib/channel-avatar-proxy";

type ChannelAvatarCircleProps = {
  imageUrl?: string;
  /** Used for initials and gradient when there is no image or it fails to load. */
  label: string;
  size?: "sm" | "md" | "lg";
};

export function ChannelAvatarCircle({
  imageUrl,
  label,
  size = "md",
}: ChannelAvatarCircleProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const invidiousOrigins = useInvidiousOrigins();
  const resolvedImageUrl = toBrowserChannelAvatarUrl(imageUrl, invidiousOrigins);
  const initials = initialsFromLabel(label);
  const avatarBg = gradientForChannelId(label);
  const sizeClass =
    size === "sm"
      ? "h-6 w-6 text-[10px]"
      : size === "lg"
        ? "h-10 w-10 text-sm"
        : "h-9 w-9 text-xs";
  const showImg =
    Boolean(resolvedImageUrl) && failedImageUrl !== resolvedImageUrl;

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${sizeClass}`}
      style={showImg ? undefined : { background: avatarBg }}
      aria-hidden
    >
      {showImg ? (
        // biome-ignore lint/performance/noImgElement: upstream channel avatars
        <img
          src={resolvedImageUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedImageUrl(resolvedImageUrl ?? null)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
