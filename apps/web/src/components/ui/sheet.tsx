"use client";

import { Drawer } from "@base-ui/react/drawer";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet — the app's mobile modal idiom (player options, video actions,
 * home block editor, account menu).
 *
 * Built on Base UI's Drawer, which owns the hard parts: swipe-to-dismiss with
 * real gesture tracking (including mid-gesture handoff between an inner
 * scrollable and the sheet), focus trap, scroll lock, and aria wiring. It
 * supersedes vaul (unmaintained since Dec 2024) and is what shadcn's Drawer
 * moved to. Animation is CSS — see `.ot-sheet-*` in globals.css, driven by
 * Base UI's `--drawer-swipe-movement-y` / `data-swiping` / `data-*-style`.
 *
 * `container` portals the sheet into a specific element instead of `<body>`:
 * the player passes its fullscreen shell, because a body-level portal does not
 * paint while an element is fullscreened.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  container,
  children,
  panelClassName,
  contentClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the dialog (visually hidden). */
  title: string;
  /** Portal target; defaults to `<body>`. */
  container?: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Panel surface (colors/border). Defaults to the card surface. */
  panelClassName?: string;
  contentClassName?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal container={container}>
        <Drawer.Backdrop className="ot-sheet-backdrop fixed inset-0 z-[70] bg-black/55" />
        <Drawer.Viewport className="fixed inset-0 z-[70] flex flex-col justify-end">
          <Drawer.Popup
            className={cn(
              "ot-sheet-popup flex max-h-[85dvh] flex-col rounded-t-[20px] border-t shadow-2xl outline-none",
              panelClassName ??
                "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]",
            )}
          >
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            <span
              aria-hidden
              className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-current opacity-25"
            />
            <Drawer.Content
              className={cn(
                "min-h-0 flex-1 overflow-y-auto pb-[max(env(safe-area-inset-bottom),0.5rem)]",
                contentClassName,
              )}
            >
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
