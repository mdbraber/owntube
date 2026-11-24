/**
 * Makes gradle read the version from package.json at build time, so a
 * version bump reaches the APK without another `expo prebuild` (android/ is
 * generated and not committed, and otherwise keeps the version it was
 * generated with). Same formula as plugins/version-code.js.
 */
const {
  withAppBuildGradle,
  createRunOncePlugin,
} = require("expo/config-plugins");

const MARKER = "// Version from package.json (with-version-from-package).";

const DEFINITIONS = `${MARKER}
def owntubeVersion = new groovy.json.JsonSlurper()
    .parse(file("../../package.json")).version
def owntubeVersionCode = { String v ->
    def (major, minor, patch) = (v =~ /^(\\d+)\\.(\\d+)\\.(\\d+)/)[0][1..3]*.toInteger()
    major * 10000 + minor * 100 + patch
}(owntubeVersion)
`;

/** android/app/build.gradle with the version read from package.json. */
function applyVersionFromPackage(contents) {
  if (contents.includes(MARKER)) return contents;
  const src = contents
    .replace(/^(\s*)versionCode\s+\d+\s*$/m, "$1versionCode owntubeVersionCode")
    .replace(
      /^(\s*)versionName\s+"[^"]*"\s*$/m,
      "$1versionName owntubeVersion",
    );
  if (!src.includes("versionCode owntubeVersionCode")) {
    throw new Error("with-version-from-package: no versionCode line found");
  }
  return src.replace(/^android\s*\{/m, `${DEFINITIONS}\nandroid {`);
}

function withVersionFromPackage(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyVersionFromPackage(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = createRunOncePlugin(
  withVersionFromPackage,
  "with-version-from-package",
  "1.0.0",
);
module.exports.applyVersionFromPackage = applyVersionFromPackage;
