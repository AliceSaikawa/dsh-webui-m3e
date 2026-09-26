import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // Preserve earlier failure evidence instead of clearing it on the next run.
  outputDir: `${root}tmp/e2e-results/${Date.now()}`,
  reporter: [['list'], ['json', { outputFile: `${root}tmp/e2e-report.json` }]],
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
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5191 --strictPort',
    cwd: root,
    // 5190 is occupied by an existing IPv4 listener in this workspace's host.
    // Pin IPv4 and a separate port so another local server cannot be reused.
    port: 5191,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
  },
})
