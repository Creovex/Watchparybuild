import { defineConfig } from '@playwright/test';

// Optional browser check for the sync extension (apps/extension/e2e). It loads the built extension
// into Chromium and needs the web app already running on http://localhost:3000; it starts no
// server of its own. Skipped unless EXTENSION_E2E=1.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
});
