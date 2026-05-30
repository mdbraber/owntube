import { FAVICON_VERSION } from "@/lib/favicon";
import { THEME_STORAGE_KEY } from "@/lib/theme-appearance";

/** Runs before paint so the tab icon matches app theme, not only OS preference. */
export function FaviconInitScript() {
  const script = `
(function () {
  try {
    var storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
    var version = ${JSON.stringify(FAVICON_VERSION)};
    var theme = "system";
    var raw = localStorage.getItem(storageKey);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.state && parsed.state.theme) {
        theme = parsed.state.theme;
      }
    }
    var isDark =
      theme === "dark" ||
      (theme !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    var variant = isDark ? "dark" : "light";
    var href = "/favicon-" + variant + ".ico?v=" + version;
    document
      .querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')
      .forEach(function (node) {
        node.remove();
      });
    var link = document.createElement("link");
    link.rel = "icon";
    link.href = href;
    document.head.appendChild(link);
  } catch (_) {}
})();
`.trim();

  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: inline boot script
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
