/**
 * The tab the user is browsing (its route segment: "(home)", "subscriptions"…).
 * The player panel opens pages there when it's swiped away for them, as
 * YouTube does with a channel tapped in the player.
 */
let currentTab: string | undefined;

export function setCurrentTab(tab: string | undefined) {
  if (tab) currentTab = tab;
}

export function getCurrentTab(): string | undefined {
  return currentTab;
}
