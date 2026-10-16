import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import base from './playwright.config.ts'

// Gecko (Firefox) run of the same ?mock specs. Android Iceraven also uses Gecko,
// but this desktop Firefox run does not replace checks on the real device (#98).
const root = fileURLToPath(new URL('../', import.meta.url))
const ci = !!process.env.CI
const port = 5193

export default defineConfig({
  ...base,
  outputDir: `${root}tmp/e2e-firefox-results/${Date.now()}`,
  reporter: [
    ...(ci ? [['github'] as const] : []),
    ['list'],
    ['json', { outputFile: `${root}tmp/e2e-firefox-report.json` }],
  ],
  use: {
    ...base.use,
    browserName: 'firefox',
    baseURL: `http://localhost:${port}`,
    launchOptions: process.env.M3E_FIREFOX_PATH ? { executablePath: process.env.M3E_FIREFOX_PATH } : {},
  },
  webServer: {
    ...(base.webServer as object),
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    port,
  },
})
