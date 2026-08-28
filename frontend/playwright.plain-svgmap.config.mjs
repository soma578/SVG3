import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'plain-svgmap-managed-layers.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4176',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node frontend/scripts/static-test-server.mjs 4176 .',
    cwd: '..',
    url: 'http://127.0.0.1:4176/frontend/e2e/fixtures/plain-svgmap/index.html',
    reuseExistingServer: true,
    timeout: 15_000,
  },
})
