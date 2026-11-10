import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: 'movies.acceptance.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  reporter: 'list',
  use: {
    baseURL: process.env.MOVIE_E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'off',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH ?? '/usr/bin/chromium',
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    },
  },
});
