import { resolveIsDarkTheme, type ThemeMode } from "@/lib/theme-appearance";

export const FAVICON_VERSION = "9";

export function faviconUrls(isDark: boolean) {
  const variant = isDark ? "dark" : "light";
  const query = `?v=${FAVICON_VERSION}`;
  return {
    ico: `/favicon-${variant}.ico${query}`,
    png: `/logo-${variant}.png${query}`,
  };
}

function upsertLink(rel: string, href: string, type?: string, sizes?: string) {
  const selector = type
    ? `link[rel="${rel}"][type="${type}"]`
    : `link[rel="${rel}"]:not([type])`;
  let link = document.querySelector<HTMLLinkElement>(selector);

  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    if (type) link.type = type;
    if (sizes) link.sizes = sizes;
    document.head.appendChild(link);
  }

  link.href = href;
}

export function applyFaviconForTheme(theme: ThemeMode) {
  const urls = faviconUrls(resolveIsDarkTheme(theme));

  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"]',
  )) {
    link.remove();
  }

  upsertLink("icon", urls.ico);
  upsertLink("icon", urls.png, "image/png", "192x192");
}

export function faviconMatchesTheme(theme: ThemeMode): boolean {
  const variant = resolveIsDarkTheme(theme) ? "dark" : "light";
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"]',
  );
  if (links.length === 0) return false;

  for (const link of links) {
    if (link.href.includes(`/favicon-${variant}.ico`)) return true;
  }
  return false;
}
