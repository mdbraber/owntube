import { router } from "expo-router";

/**
 * Opens a web page in a tab as a fresh screen over the tab's first screen:
 * Back goes to that first screen, not into whatever was open before. Quick
 * actions use it; links from outside the app go through +native-intent.
 */
export function openPageInTab(
  tab: "/" | "/subscriptions" | "/library" | "/search",
  path: string,
  title?: string,
) {
  router.dismissTo(tab as never);
  router.push({
    pathname: (tab === "/" ? "/page" : `${tab}/page`) as never,
    params: title ? { path, title } : { path },
  });
}
