// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*'],
  },
  {
    // The shared packages are aliased to their source in metro.config.js / tsconfig.json.
    settings: { 'import/ignore': ['@pocket-agent/'] },
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^@pocket-agent/'] }],
      // eslint-plugin-import can't parse React Native's own (Flow) source.
      'import/namespace': 'off',
    },
  },
]);
