import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

/**
 * Real-DSH integration: a real DSH Host (see ./dsh-host.ts) with the scripted
 * fake model. Not part of `pnpm test`; it installs DSH from npm on first run.
 * Results are about the Host and transport only: the model is always fake.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The first test also installs DSH, builds, and packs the plugin.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: `${root}tmp/dsh-integration/results/${Date.now()}`,
  reporter: [['list'], ['json', { outputFile: `${root}tmp/dsh-integration/report.json` }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // For hosts whose installed browser build differs from this Playwright release.
    ...(process.env.M3E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.M3E_CHROMIUM_PATH } } : {}),
  },
})
