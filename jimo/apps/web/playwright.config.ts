import { defineConfig } from '@playwright/test';

/**
 * L3 E2E smoke config.
 *
 * Assumes the dev stack is already running (frontend :8000 + backend :8888):
 *   cd release/jimo && bash scripts/dev.sh
 * Then:  pnpm test:e2e
 *
 * Browser binaries are expected in the system cache (chromium). If missing:
 *   pnpm exec playwright install chromium
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // E2E shares one dev stack / DB — serialize
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:8000',
    headless: true,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
});
