import { defineConfig, devices } from '@playwright/test';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

/**
 * Playwright E2E configuration for InkFlow.
 * Targets the fully integrated developer portal running on http://localhost:3000.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // E2E tests interact with local database, run sequentially
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(chromiumExecutablePath ? {
      launchOptions: {
        executablePath: chromiumExecutablePath,
      },
    } : {}),
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile-layout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /mobile-layout\.spec\.ts/,
    },
  ],
  webServer: {
    // E2E runs against the already-built bundle so Vite middleware startup does not
    // consume the readiness budget or make startup timing-dependent.
    command: 'DISABLE_VITE_DEV_MIDDLEWARE=1 node --import tsx server.ts',
    url: 'http://localhost:3001/api/dev-auth-token',
    reuseExistingServer: false,
    // A fresh isolated SQLite database runs additive schema setup before the
    // HTTP listener is ready; allow the cold start without hiding request
    // timeouts inside the test itself.
    timeout: 120000,
    env: {
      PORT: '3001',
      PLAYWRIGHT_TEST: 'true',
      NODE_ENV: 'test',
      NODE_TEST_CONTEXT: '1',
      INKFLOW_ENABLE_DEV_AUTH_TOKEN: 'true',
      INKFLOW_DB_PATH: 'test-results/inkflow-e2e.db',
      INKFLOW_CONFIG_DIR: 'test-results/e2e-config',
    },
  },
});
