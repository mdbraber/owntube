"use client";

import { type RefObject, useEffect } from "react";

/**
 * Marks a scroll area with `data-fade-top` / `data-fade-bottom` while there is
 * more to scroll to that way, for `.ot-scroll-fade` to fade that edge: the cue
 * in place of a visible scrollbar.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      el.toggleAttribute("data-fade-top", top);
      el.toggleAttribute("data-fade-bottom", bottom);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    // Content changes (Following loading, collapsing) change scrollHeight.
    const mutate = new MutationObserver(update);
    mutate.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      mutate.disconnect();
    };
  }, [ref]);
}
