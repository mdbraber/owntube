// Metro config for the pnpm monorepo: watch the workspace root so changes in
// sibling packages are picked up, and resolve modules from both the app and the
// workspace-root node_modules (pnpm hoists shared deps to the root store).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// Avoid resolving a dependency from an unexpected nested node_modules.
config.resolver.disableHierarchicalLookup = true;
// Honor the "exports" field. Some deps (e.g. copy-anything@4 via superjson) are
// exports-only with no "main", so without this Metro can't resolve them.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
