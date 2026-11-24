/**
 * app.json plus the version, which comes from package.json (the one place a
 * release bumps it); versionCode is derived (plugins/version-code.js).
 */
const { version } = require("./package.json");
const { versionCodeFor } = require("./plugins/version-code");

module.exports = ({ config }) => ({
  ...config,
  version,
  android: { ...config.android, versionCode: versionCodeFor(version) },
  plugins: [...(config.plugins ?? []), "./plugins/with-version-from-package"],
});
