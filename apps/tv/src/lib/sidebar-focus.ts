import { createContext, useContext } from "react";

/**
 * Native handle of the sidebar row for the section on screen, for a view whose
 * Left Android's own focus search can't resolve (the search field found
 * nothing beside it and kept focus).
 */
export const SidebarFocusContext = createContext<number | null>(null);

export function useSidebarFocusHandle(): number | null {
  return useContext(SidebarFocusContext);
}
