import type { NativePlayRequest } from "@web/lib/native-app";
import * as QuickActions from "expo-quick-actions";
import { router, useRootNavigationState } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { openInHome } from "@/lib/use-incoming-links";

/**
 * The home-screen long-press menu. A quick action opens either an app route
 * (`route`) or a web page in the Home tab (`web`).
 */
type Params = { route?: string; web?: string };

const STATIC_ACTIONS: QuickActions.Action[] = [
  {
    id: "search",
    title: "Search",
    icon: "symbol:magnifyingglass",
    params: { route: "/search" },
  },
  {
    id: "subscriptions",
    title: "Subscriptions",
    icon: "symbol:play.square.stack",
    params: { route: "/subscriptions" },
  },
  {
    id: "queue",
    title: "Queue",
    icon: "symbol:text.line.first.and.arrowtriangle.forward",
    params: { route: "/library/page?path=%2Fqueue&title=Queue" },
  },
];

/**
 * Puts the last video played first in the menu, as "Resume": it opens the
 * watch page, which resumes from the position saved to history.
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
  const params = (action?.params ?? {}) as Params;
  if (params.web) openInHome(params.web);
  else if (params.route) router.navigate(params.route as never);
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
