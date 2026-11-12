import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'fullscreen.acceptance.ts', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3198', viewport: { width: 1280, height: 720 },
    launchOptions: { executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'node e2e/fullscreen-server.mjs', url: 'http://127.0.0.1:3198', reuseExistingServer: false },
});
