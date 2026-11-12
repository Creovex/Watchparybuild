import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'mkv.acceptance.ts', workers: 1, timeout: 90000,
  use: {
    baseURL: 'http://127.0.0.1:3197',
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: { command: 'node e2e/mkv-server.mjs', url: 'http://127.0.0.1:3197', reuseExistingServer: false },
});
