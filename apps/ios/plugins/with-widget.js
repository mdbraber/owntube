/**
 * Home-screen widget: OwnTube's watch queue, "Continue watching".
 *
 * Adds the WidgetKit extension in targets/widget to the generated Xcode project
 * as its own target, embedded in the app, and gives the app and the extension
 * one App Group (`group.<bundle id>`): the app's widget-bridge module writes
 * the queue there and the widget reads it. Both learn the group's name from
 * their Info.plist (`OwnTubeAppGroup`), so nothing hard-codes it.
 *
 * The iPhone counterpart of apps/tv's with-top-shelf, and built the same way.
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

const TARGET = "OwnTubeWidget";
const SOURCE_DIR = path.join(__dirname, "..", "targets", "widget");
const FILES = [`${TARGET}.swift`, "Info.plist", `${TARGET}.entitlements`];
const IOS_DEPLOYMENT_TARGET = "17.0";

const appGroupFor = (config) => `group.${config.ios.bundleIdentifier}`;

function withWidgetFiles(config) {
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

function withWidgetTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(TARGET)) return cfg;

    const bundleId = `${config.ios.bundleIdentifier}.widget`;
    // `app_extension` also embeds the product in the first (app) target.
    const target = project.addTarget(TARGET, "app_extension", TARGET, bundleId);

    const group = project.addPbxGroup(FILES, TARGET, TARGET);
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroup);

    project.addBuildPhase(
      [`${TARGET}.swift`],
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

    const appSettings =
      buildSettingsOf(project, project.getFirstTarget().uuid)[0] ?? {};
    const settings = {
      SDKROOT: "iphoneos",
      TARGETED_DEVICE_FAMILY: '"1,2"',
      IPHONEOS_DEPLOYMENT_TARGET:
        appSettings.IPHONEOS_DEPLOYMENT_TARGET ?? IOS_DEPLOYMENT_TARGET,
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

function withWidget(config) {
  config = withAppGroup(config);
  config = withWidgetFiles(config);
  return withWidgetTarget(config);
}

module.exports = createRunOncePlugin(withWidget, "with-widget", "1.0.0");
