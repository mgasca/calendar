import { defineConfig, devices } from '@playwright/test';

// End-to-end flow tests (ADR-0061): Chromium only, against the throwaway stack of `just e2e up` (ADR-0063).
// The config loads without a stack, so `playwright test --list` works for the binding check.
export default defineConfig({
  testDir: './tests',
  // Every test asserts its flow's metrics, which the API pushes on its metric export interval (60 s by default).
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // The development seed scheme acts as one user, so flows run one after another; each test owns its own day.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...(process.env.CALENDAR_E2E_WEB_URL && { baseURL: process.env.CALENDAR_E2E_WEB_URL }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
