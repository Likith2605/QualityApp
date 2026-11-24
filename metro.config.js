const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add `wasm` to the asset extensions so expo-sqlite's web (wa-sqlite) backend can load.
config.resolver.assetExts.push('wasm');

// Enable `SharedArrayBuffer` in development for expo-sqlite's sync API on web.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    return middleware(req, res, next);
  };
};

module.exports = config;
