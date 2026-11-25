"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  PAGE_ACTIONS_SLOT_ID,
  PAGE_MENU_SLOT_ID,
} from "@/components/layout/page-header";

/**
 * Puts a control from inside the page into the PageHeader's top-right slots:
 * "actions" (buttons, left) or "menu" (the ⋯ menu, rightmost). Renders
 * nothing until mounted, or on pages without a PageHeader.
 */
export function PageActions({
  slot = "actions",
  children,
}: {
  slot?: "actions" | "menu";
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(
      document.getElementById(
        slot === "menu" ? PAGE_MENU_SLOT_ID : PAGE_ACTIONS_SLOT_ID,
      ),
    );
  }, [slot]);
  return target ? createPortal(children, target) : null;
}
