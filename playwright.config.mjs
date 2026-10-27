import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3101', browserName: 'chromium', channel: 'chrome', headless: true, viewport: { width: 1440, height: 1050 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node backend/server.mjs', url: 'http://127.0.0.1:3101/api/health', reuseExistingServer: false, timeout: 30000, env: { PORT: '3101', HOST: '127.0.0.1', DATA_DIR: `.local-data/browser-test-${Date.now()}` } },
});
