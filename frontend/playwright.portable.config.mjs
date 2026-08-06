import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'portable-bundles.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: [4173, 4174].map((port) => ({
    command: `node scripts/static-test-server.mjs ${port} public`,
    url: `http://127.0.0.1:${port}/map/distribution/portable/evacuation/okayama/viewer.html`,
    reuseExistingServer: true,
    timeout: 15_000,
  })),
})
