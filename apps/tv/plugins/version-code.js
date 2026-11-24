/**
 * The TV app's version lives in package.json only. versionCode, which the
 * update check and Android's installer compare, is derived from it:
 * major * 10000 + minor * 100 + patch (0.4.0 -> 400, 1.2.3 -> 10203). Minor
 * and patch stay below 100. android/app/build.gradle repeats this formula
 * (see the with-version-from-package plugin), so keep the two in step.
 */
function versionCodeFor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Not a semver version: "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(`Minor and patch must stay below 100: "${version}"`);
  }
  return major * 10000 + minor * 100 + patch;
}

module.exports = { versionCodeFor };
