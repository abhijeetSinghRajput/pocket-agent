// Metro for the Pocket Agent app. The app is its own npm project inside the repository; the two
// shared packages (types/schemas and client logic, also used by the web app) are bundled straight
// from their TypeScript source, so there is no build step between editing them and running the app.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const packages = path.resolve(projectRoot, '../../packages');
const SHARED = {
  '@pocket-agent/protocol': path.join(packages, 'protocol', 'src', 'index.ts'),
  '@pocket-agent/core': path.join(packages, 'core', 'src', 'index.ts'),
};

const config = getDefaultConfig(projectRoot);

config.watchFolders = [path.join(packages, 'protocol', 'src'), path.join(packages, 'core', 'src')];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shared = SHARED[moduleName];
  if (shared) return { type: 'sourceFile', filePath: shared };

  if (context.originModulePath.startsWith(packages)) {
    // The packages are written as Node ESM TypeScript: `./events.js` means `./events.ts`.
    if (moduleName.startsWith('.')) {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, ''), platform);
    }
    // Their dependencies (zod) come from the app's own node_modules: one copy in the bundle.
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
