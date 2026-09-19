const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8081',
    channel: 'msedge',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run web',
    url: 'http://127.0.0.1:8081',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
