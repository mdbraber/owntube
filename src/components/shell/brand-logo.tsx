"use client";

import Link from "next/link";
import { BrandLogoIcon } from "@/components/shell/brand-logo-icon";

type BrandLogoProps = {
  showText?: boolean;
  /** Smaller mark for the shell topbar when the sidebar is collapsed. */
  compact?: boolean;
  className?: string;
  onNavigate?: () => void;
};

export function BrandLogo({
  showText = true,
  compact = false,
  className,
  onNavigate,
}: BrandLogoProps) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className={`inline-flex items-center gap-2 rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))] ${className ?? ""}`}
      aria-label="owntube home"
    >
      <BrandLogoIcon
        size={compact ? 30 : 36}
        className={compact ? "h-8 w-8" : "h-9 w-9"}
      />
      {showText ? (
        <span
          className={`font-extrabold tracking-tight text-[hsl(var(--foreground))] ${compact ? "text-base" : "text-lg"}`}
        >
          owntube
        </span>
      ) : null}
    </Link>
  );
}
