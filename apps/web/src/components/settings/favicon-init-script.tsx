import { THEME_STORAGE_KEY } from "@/lib/theme-appearance";

/** Runs before paint so persisted appearance and visual theme apply before hydration. */
export function FaviconInitScript() {
  const script = `
(function () {
  try {
    var storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
    var theme = "system";
    var raw = localStorage.getItem(storageKey);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.state && parsed.state.theme) {
        theme = parsed.state.theme;
      }
      if (parsed && parsed.state && parsed.state.visualTheme === "terminal") {
        document.documentElement.dataset.visualTheme = "terminal";
      }
    }
    document.documentElement.classList.remove("light", "dark");
    if (theme === "light") {
      document.documentElement.classList.add("light");
    }
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    }
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
