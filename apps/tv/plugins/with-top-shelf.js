/**
 * Apple TV Top Shelf: OwnTube's Continue watching row on the tvOS home screen,
 * the counterpart of Android TV's Watch Next (modules/watch-next).
 *
 * Adds the TV Top Shelf extension in targets/top-shelf to the generated Xcode
 * project as its own target, embedded in the app, and gives the app and the
 * extension one App Group (`group.<bundle id>`): the app's watch-next module
 * writes the list there and the extension reads it. Both learn the group's
 * name from their Info.plist (`OwnTubeAppGroup`), so nothing hard-codes it.
 *
 * Only for tvOS builds (EXPO_TV=1); an iPhone build has no Top Shelf.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
  createRunOncePlugin,
} = require("expo/config-plugins");

const TARGET = "OwnTubeTopShelf";
const SOURCE_DIR = path.join(__dirname, "..", "targets", "top-shelf");
const FILES = ["ContentProvider.swift", "Info.plist", `${TARGET}.entitlements`];
const TVOS_DEPLOYMENT_TARGET = "16.4";

const isTV = () =>
  process.env.EXPO_TV === "1" || process.env.EXPO_TV === "true";
const appGroupFor = (config) => `group.${config.ios.bundleIdentifier}`;

function withTopShelfFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const dest = path.join(cfg.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of FILES) {
        fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(dest, file));
      }
      return cfg;
    },
  ]);
}

function withTopShelfTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(TARGET)) return cfg;

    const bundleId = `${config.ios.bundleIdentifier}.topshelf`;
    // `app_extension` also embeds the product in the first (app) target.
    const target = project.addTarget(TARGET, "app_extension", TARGET, bundleId);

    const group = project.addPbxGroup(FILES, TARGET, TARGET);
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroup);

    project.addBuildPhase(
      ["ContentProvider.swift"],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      target.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      target.uuid,
    );

    // The xcode package only knows iOS extensions.
    project.pbxNativeTargetSection()[target.uuid].productType =
      '"com.apple.product-type.tv-app-extension"';

    const appSettings =
      buildSettingsOf(project, project.getFirstTarget().uuid)[0] ?? {};
    const settings = {
      SDKROOT: "appletvos",
      SUPPORTED_PLATFORMS: '"appletvos appletvsimulator"',
      TARGETED_DEVICE_FAMILY: "3",
      TVOS_DEPLOYMENT_TARGET:
        appSettings.TVOS_DEPLOYMENT_TARGET ?? TVOS_DEPLOYMENT_TARGET,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      PRODUCT_BUNDLE_IDENTIFIER: bundleId,
      INFOPLIST_FILE: `${TARGET}/Info.plist`,
      CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
      CODE_SIGN_STYLE: "Automatic",
      OWNTUBE_APP_GROUP: appGroupFor(config),
      MARKETING_VERSION: config.version ?? "1.0.0",
      CURRENT_PROJECT_VERSION: config.ios?.buildNumber ?? "1",
      SWIFT_VERSION: "5.0",
      CLANG_ENABLE_MODULES: "YES",
      GENERATE_INFOPLIST_FILE: "NO",
      SKIP_INSTALL: "YES",
      LD_RUNPATH_SEARCH_PATHS:
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
    };
    if (appSettings.DEVELOPMENT_TEAM) {
      settings.DEVELOPMENT_TEAM = appSettings.DEVELOPMENT_TEAM;
    }
    for (const buildSettings of buildSettingsOf(project, target.uuid)) {
      Object.assign(buildSettings, settings);
    }
    return cfg;
  });
}

/** The build settings of each configuration (Debug, Release) of a target. */
function buildSettingsOf(project, targetUuid) {
  const native = project.pbxNativeTargetSection()[targetUuid];
  const list = project.pbxXCConfigurationList()[native.buildConfigurationList];
  const configurations = project.pbxXCBuildConfigurationSection();
  return list.buildConfigurations.map(
    ({ value }) => configurations[value].buildSettings,
  );
}

function withAppGroup(config) {
  config = withEntitlementsPlist(config, (cfg) => {
    const key = "com.apple.security.application-groups";
    const groups = new Set(cfg.modResults[key] ?? []);
    groups.add(appGroupFor(config));
    cfg.modResults[key] = [...groups];
    return cfg;
  });
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.OwnTubeAppGroup = appGroupFor(config);
    return cfg;
  });
}

function withTopShelf(config) {
  if (!isTV()) return config;
  config = withAppGroup(config);
  config = withTopShelfFiles(config);
  return withTopShelfTarget(config);
}

module.exports = createRunOncePlugin(withTopShelf, "with-top-shelf", "1.0.0");
