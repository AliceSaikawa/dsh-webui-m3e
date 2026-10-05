import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { productionModuleGuard } from './scripts/production-modules.ts'

export default defineConfig({
  root: 'web',
  // Served by the Host half under /m3e (src/host/index.ts MOUNT).
  base: '/m3e/',
  plugins: [react(), productionModuleGuard()],
  resolve: {
    alias: {
      // cordis-plugin-loader imports createRequire for its Node path; the
      // browser path always goes through `loader.internal` instead.
      'node:module': fileURLToPath(new URL('web/src/dsh/node-module-shim.ts', import.meta.url)),
    },
  },
  // The loader probes Node internals when it is constructed. A Node major
  // below 22 makes that probe return early, and the browser path never needs it.
  define: {
    'process.env.CORDIS_SHARED': 'undefined',
    'process.versions.node': '"0"',
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    // Keep the release allowlist's name + 8-character hash contract explicit.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash:8].js',
        chunkFileNames: 'assets/[name]-[hash:8].js',
        assetFileNames: 'assets/[name]-[hash:8][extname]',
      },
    },
  },
})
