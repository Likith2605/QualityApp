const { withExpo } = require('@expo/webpack-config');
const path = require('path');

module.exports = async function(env, argv) {
    const config = await withExpo(env, argv);

    // Ensure WebAssembly assets can be loaded by the Expo web bundler.
    config.resolve.extensions = config.resolve.extensions || [];
    if (!config.resolve.extensions.includes('.wasm')) {
        config.resolve.extensions.push('.wasm');
    }

    config.resolve.alias = {
        ...(config.resolve.alias || {}),
        'expo-sqlite/kv-store': path.resolve(__dirname, 'src/web/kvStore.ts'),
    };

    config.module.rules.push({
        test: /\.wasm$/,
        type: 'asset/resource',
    });

    config.experiments = {
        ...(config.experiments || {}),
        asyncWebAssembly: true,
        syncWebAssembly: true,
    };

    return config;
};