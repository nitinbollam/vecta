const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root so Metro can find workspace packages (e.g. @vecta/types)
// Merge with any defaults Expo may have already set
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

// Resolve modules from both the app's and the workspace root's node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
