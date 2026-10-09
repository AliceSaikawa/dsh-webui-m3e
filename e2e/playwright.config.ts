import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const ci = !!process.env.CI

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // CI runners are slower than the local machines. Only the waiting time grows;
  // parallelism, retries and assertions stay the same so CI cannot turn green
  // through a weaker test.
  timeout: ci ? 60_000 : 30_000,
  expect: { timeout: ci ? 15_000 : 7_000 },
  forbidOnly: ci,
  // Preserve earlier failure evidence instead of clearing it on the next run.
  // CI needs a fixed path so the evidence can be uploaded as an artifact.
  outputDir: `${root}tmp/e2e-results/${ci ? 'ci' : Date.now()}`,
  reporter: [
    ...(ci ? [['github'] as const] : []),
    ['list'],
    ['json', { outputFile: `${root}tmp/e2e-report.json` }],
  ],
  use: {
    browserName: 'chromium',
    baseURL: 'http://localhost:5191',
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // For hosts whose installed browser build differs from this Playwright release.
    ...(process.env.M3E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.M3E_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5191 --strictPort',
    cwd: root,
    // 5190 is occupied by an existing IPv4 listener in this workspace's host.
    // Pin IPv4 and a separate port so another local server cannot be reused.
    port: 5191,
    reuseExistingServer: false,
    // A cold runner spends longer than 30 s in Vite's dependency optimization,
    // which would fail every browser test before the first one starts.
    timeout: ci ? 120_000 : 30_000,
    stdout: 'pipe',
  },
})
