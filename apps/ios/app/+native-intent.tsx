/**
 * URLs that open the app are handled by useIncomingLinks (root layout), which
 * turns them into a page in the Home tab. Keep the router itself from trying
 * to match them against the app's routes.
 */
export function redirectSystemPath(_: { path: string; initial: boolean }) {
  return "/";
}
