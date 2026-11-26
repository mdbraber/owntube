import type { NativePlayRequest } from "@web/lib/native-app";
import * as QuickActions from "expo-quick-actions";
import { router, useRootNavigationState } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { openPageInTab } from "@/lib/use-incoming-links";

/**
 * The home-screen long-press menu. A quick action opens a tab (`tab`),
 * optionally with a web page pushed fresh over its first screen (`path`), or
 * a video in the player panel (`video`).
 */
type Tab = "/" | "/subscriptions" | "/library" | "/search";
type Params = { tab?: Tab; path?: string; title?: string; video?: string };

const STATIC_ACTIONS: QuickActions.Action[] = [
  {
    id: "search",
    title: "Search",
    icon: "symbol:magnifyingglass",
    params: { tab: "/search" },
  },
  {
    id: "subscriptions",
    title: "Subscriptions",
    icon: "symbol:play.square.stack",
    params: { tab: "/subscriptions" },
  },
  {
    id: "queue",
    title: "Queue",
    icon: "symbol:text.line.first.and.arrowtriangle.forward",
    params: { tab: "/library", path: "/queue", title: "Queue" },
  },
];

/**
 * Puts the last video played first in the menu, as "Resume": it opens the
 * player panel, whose page resumes from the position saved to history.
 */
const RESUME_KEY = "owntube.quick-action.resume";

type ResumeVideo = Pick<NativePlayRequest, "videoId" | "title">;

export function setResumeAction(video: NativePlayRequest | null) {
  const resume = video && !video.isLive ? video : null;
  void (
    resume
      ? SecureStore.setItemAsync(
          RESUME_KEY,
          JSON.stringify({ videoId: resume.videoId, title: resume.title }),
        )
      : SecureStore.deleteItemAsync(RESUME_KEY)
  ).catch(() => {});
  applyActions(resume);
}

function applyActions(video: ResumeVideo | null) {
  const resume: QuickActions.Action[] = video
    ? [
        {
          id: "resume",
          title: "Resume",
          subtitle: video.title,
          icon: "symbol:play.circle",
          params: { web: `/watch?v=${encodeURIComponent(video.videoId)}` },
        },
      ]
    : [];
  void QuickActions.setItems([...resume, ...STATIC_ACTIONS]).catch(() => {});
}

function perform(action: QuickActions.Action | undefined) {
  const { tab, path, title, video } = (action?.params ?? {}) as Params;
  if (video) {
    router.navigate({ pathname: "/player", params: { v: video } });
    return;
  }
  if (!tab) return;
  if (path) openPageInTab(tab, path, title);
  else router.dismissTo(tab as never);
}

/**
 * Handles quick actions: the one launching the app and each one used while it
 * runs. Mounted once, in the root layout. Sets the menu on launch, with the
 * Resume item kept from the last session.
 */
export function useQuickActions() {
  const ready = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (!ready) return;
    let stored: ResumeVideo | null = null;
    try {
      const raw = SecureStore.getItem(RESUME_KEY);
      stored = raw ? (JSON.parse(raw) as ResumeVideo) : null;
    } catch {}
    applyActions(stored);
    perform(QuickActions.initial);
    const subscription = QuickActions.addListener(perform);
    return () => subscription.remove();
  }, [ready]);
}
