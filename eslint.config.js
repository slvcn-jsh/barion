const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/**',
      '.expo/**',
      'assets/Barion_Bari_3D_Repository_Starter_Pack/**',
    ],
    rules: {
      // React Native Animated values are intentionally read during render to build interpolation nodes.
      'react-hooks/refs': 'off',
      // Event timestamps and one-time state hydration are valid in this non-compiled Expo runtime.
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
