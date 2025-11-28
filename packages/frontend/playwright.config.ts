import { defineConfig, devices } from '@playwright/test';

// E2E test environment URLs
const TEST_FRONTEND_URL = process.env.TEST_FRONTEND_URL || 'http://localhost:3002';
const TEST_API_URL = process.env.TEST_API_URL || 'http://localhost:3001';

// Check if running in E2E mode (using docker-compose test environment)
const isE2E = process.env.E2E === 'true' || process.env.CI === 'true';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially to avoid race conditions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1, // Single worker for stability
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ...(process.env.CI ? [['github' as const]] : []),
  ],

  // Global timeout
  timeout: 60000, // 60 seconds per test
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },

  use: {
    // Use E2E frontend URL when in E2E mode
    baseURL: isE2E ? TEST_FRONTEND_URL : 'http://localhost:5173',

    // Capture trace on first retry
    trace: 'on-first-retry',

    // Screenshots on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'on-first-retry',

    // Browser context options
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,

    // Action timeout
    actionTimeout: 10000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  // Test projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Enable these for full browser coverage
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
    // Mobile viewports
    // {
    //   name: 'mobile-chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
  ],

  // Web server configuration (only for dev mode, not E2E)
  ...(isE2E
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120000,
        },
      }),

  // Output directory for test artifacts
  outputDir: 'test-results',

  // Global setup/teardown
  globalSetup: isE2E ? './tests/global-setup.ts' : undefined,
  globalTeardown: isE2E ? './tests/global-teardown.ts' : undefined,
});
