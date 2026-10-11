import { defineConfig, devices } from '@playwright/test';

// End to end tests run against the local Supabase stack (`pnpm db:start`) and a Next.js dev server
// built for tests: NEXT_PUBLIC_E2E swaps YouTube for a local video (the stub adapter) and
// NEXT_PUBLIC_DEV_EMAIL_SIGNIN turns on email and password sign in, which exists on the local stack
// only. Tests share one database, so they run one at a time.

const PORT = Number(process.env.E2E_PORT ?? 3100);
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.E2E_EDGE === '1' ? [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }] : []),
  ],
  webServer: {
    command: `pnpm --filter @watchparty/web exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_E2E: '1',
      NEXT_PUBLIC_DEV_EMAIL_SIGNIN: '1',
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      ...(process.env.E2E_SUPABASE_URL ? { NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL } : {}),
      ...(process.env.E2E_SUPABASE_ANON_KEY ? { NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY } : {}),
    },
  },
});
