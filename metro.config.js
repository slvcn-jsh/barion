const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Bari's runtime model is a bundled GLB asset. Expo SDK 57 resolves non-image
// assets to a URL on web and a module ID on native, so both renderers can use
// the same static require.
if (!config.resolver.assetExts.includes('glb')) {
  config.resolver.assetExts.push('glb');
}

// expo-sqlite's web worker uses SharedArrayBuffer. Expo's SDK 57 web
// documentation requires cross-origin isolation for the worker, including
// during local development. The router header config covers hosted exports;
// this middleware covers the Metro development server as well.
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  const enhanced = enhanceMiddleware
    ? enhanceMiddleware(middleware, metroServer)
    : middleware;

  return (request, response, next) => {
    response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return enhanced(request, response, next);
  };
};

module.exports = config;
