import { resolveIsDarkTheme, type ThemeMode } from "@/lib/theme-appearance";

export const FAVICON_VERSION = "10";

export function faviconUrls(isDark: boolean) {
  const variant = isDark ? "dark" : "light";
  const query = `?v=${FAVICON_VERSION}`;
  return {
    ico: `/favicon-${variant}.ico${query}`,
    png: `/logo-${variant}.png${query}`,
  };
}

function updateLink(link: HTMLLinkElement, href: string, sizes?: string) {
  if (sizes) link.setAttribute("sizes", sizes);
  link.href = href;
}

function upsertThemeIcon(href: string) {
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"]:not([type]), link[rel="shortcut icon"]:not([type])',
  );

  for (const link of links) {
    updateLink(link, href, "any");
  }
}

function upsertLink(rel: string, href: string, type: string, sizes?: string) {
  const selector = type
    ? `link[rel="${rel}"][type="${type}"]`
    : `link[rel="${rel}"]:not([type])`;
  let link = document.querySelector<HTMLLinkElement>(selector);

  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    if (type) link.type = type;
    document.head.appendChild(link);
  }

  updateLink(link, href, sizes);
}

export function applyFaviconForTheme(theme: ThemeMode) {
  const urls = faviconUrls(resolveIsDarkTheme(theme));

  upsertThemeIcon(urls.ico);
  upsertLink("icon", urls.png, "image/png", "192x192");
}

export function faviconMatchesTheme(theme: ThemeMode): boolean {
  const variant = resolveIsDarkTheme(theme) ? "dark" : "light";
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"]',
  );
  const themeIconLinks = Array.from(links).filter((link) =>
    /\/favicon-(dark|light)\.ico/.test(link.href),
  );
  if (themeIconLinks.length === 0) return false;

  return themeIconLinks.every((link) =>
    link.href.includes(`/favicon-${variant}.ico`),
  );
}
