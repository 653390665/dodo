import { defineConfig, devices } from '@playwright/test';

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
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001/api/dev-auth-token',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: '3001',
      PLAYWRIGHT_TEST: 'true',
      NODE_ENV: 'test',
    },
  },
});
