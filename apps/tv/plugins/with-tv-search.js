/**
 * Android TV voice search.
 *
 * This box has no in-app speech recogniser — `cmd package query-services
 * android.speech.RecognitionService` returns nothing — so `SpeechRecognizer`
 * can't work here. The platform's own model is different anyway: the launcher
 * or Assistant captures the speech and hands the app an ACTION_SEARCH intent
 * carrying the text, so the system owns the microphone.
 *
 * React Native surfaces deep links but not intent extras, so rather than ship a
 * native module just to read one string, MainActivity rewrites the search
 * intent into a `owntube://search?q=…` VIEW intent that Linking already
 * delivers.
 */
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  createRunOncePlugin,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const SEARCHABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<searchable xmlns:android="http://schemas.android.com/apk/res/android"
    android:label="@string/app_name"
    android:hint="@string/app_name" />
`;

/** res/xml/searchable.xml, referenced by the activity's searchable metadata. */
const withSearchableResource = (config) =>
  withDangerousMod(config, [
    "android",
    async (config) => {
      const dir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(
        path.join(dir, "searchable.xml"),
        SEARCHABLE_XML,
      );
      return config;
    },
  ]);

const withSearchIntentFilter = (config) =>
  withAndroidManifest(config, (config) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(
      config.modResults,
    );

    activity["intent-filter"] = activity["intent-filter"] ?? [];
    const hasSearch = activity["intent-filter"].some((filter) =>
      filter.action?.some(
        (a) => a.$?.["android:name"] === "android.intent.action.SEARCH",
      ),
    );
    if (!hasSearch) {
      activity["intent-filter"].push({
        action: [{ $: { "android:name": "android.intent.action.SEARCH" } }],
      });
    }

    activity["meta-data"] = activity["meta-data"] ?? [];
    const hasMeta = activity["meta-data"].some(
      (m) => m.$?.["android:name"] === "android.app.searchable",
    );
    if (!hasMeta) {
      activity["meta-data"].push({
        $: {
          "android:name": "android.app.searchable",
          "android:resource": "@xml/searchable",
        },
      });
    }
    return config;
  });

const HELPER = `
  /** Rewrites a system search intent so React Native's Linking receives it. */
  private fun translateSearchIntent(intent: android.content.Intent?) {
    if (intent?.action != android.content.Intent.ACTION_SEARCH) return
    val query = intent.getStringExtra(android.app.SearchManager.QUERY) ?: return
    intent.action = android.content.Intent.ACTION_VIEW
    intent.data = android.net.Uri.parse(
      "owntube://search?q=" + android.net.Uri.encode(query)
    )
  }

  override fun onNewIntent(intent: android.content.Intent) {
    translateSearchIntent(intent)
    super.onNewIntent(intent)
  }
`;

const withSearchIntentBridge = (config) =>
  withMainActivity(config, (config) => {
    let src = config.modResults.contents;
    if (src.includes("translateSearchIntent")) return config;

    // Rewrite before super.onCreate so the delegate reads the translated intent.
    src = src.replace(
      "    setTheme(R.style.AppTheme);",
      "    translateSearchIntent(intent)\n    setTheme(R.style.AppTheme);",
    );
    // Append the helper inside the class (before its final brace).
    const lastBrace = src.lastIndexOf("}");
    src = `${src.slice(0, lastBrace)}${HELPER}${src.slice(lastBrace)}`;
    config.modResults.contents = src;
    return config;
  });

const withTvSearch = (config) =>
  withSearchIntentBridge(
    withSearchIntentFilter(withSearchableResource(config)),
  );

module.exports = createRunOncePlugin(withTvSearch, "with-tv-search", "1.0.0");
