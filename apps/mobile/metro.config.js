const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');
const fs = require('fs');

// Find the project and workspace directories
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot);

// 1. Watch all files within the monorepo (spread defaults so Expo's own folders aren't lost)
config.watchFolders = [...(config.watchFolders || []), monorepoRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Block the root node_modules/react ONLY when a local copy exists (mobile has 19.x, web has 18.x).
//    Don't block react-native — it's hoisted to root and there's no duplicate.
const esc = (s) => s.replace(/[/\\]/g, '[/\\\\]');
const localReact = path.resolve(projectRoot, 'node_modules', 'react');
const additionalBlockList = [];
if (fs.existsSync(localReact)) {
  additionalBlockList.push(
    new RegExp(esc(path.resolve(monorepoRoot, 'node_modules', 'react')) + '[/\\\\].*')
  );
}
if (additionalBlockList.length > 0) {
  config.resolver.blockList = [
    ...(config.resolver.blockList || []),
    ...additionalBlockList,
  ];
}

// 4. Help Metro resolve hoisted packages that aren't in the local node_modules.
//    npm workspaces hoists everything to the root, so Metro needs explicit pointers.
const rootModules = path.resolve(monorepoRoot, 'node_modules');
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (_target, name) => {
      // Check local node_modules first, then fall back to root
      const localPath = path.resolve(projectRoot, 'node_modules', String(name));
      if (fs.existsSync(localPath)) return localPath;
      return path.resolve(rootModules, String(name));
    },
  },
);

module.exports = config;
