const { defineConfig } = require('@playwright/test');

const port = Number(process.env.BARION_E2E_PORT || 8091);
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: 'ai-fallback.spec.js',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    channel: 'msedge',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run web -- --web',
    env: {
      ...process.env,
      BARION_WEB_PORT: String(port),
      BARION_METRO_PORT: String(port + 1),
      EXPO_PUBLIC_BARION_AI_GATEWAY_URL: 'http://127.0.0.1:8790',
      EXPO_PUBLIC_BARION_AI_MODEL: 'e2e-test-model',
      EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN: 'e2e-test-token',
    },
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
