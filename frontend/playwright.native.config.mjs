import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'native-*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    launchOptions: process.env.SVG3_LIVE_EXTERNAL === '1'
      ? { args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessPermission'] }
      : undefined,
  },
  webServer: {
    command: 'node scripts/static-test-server.mjs 4175 public',
    url: 'http://127.0.0.1:4175/map/webapp/native-map.html',
    reuseExistingServer: true,
    timeout: 15_000,
  },
})
