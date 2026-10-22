import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname, 'island-harness'),
  // Keep simultaneous harnesses and the desktop dev server from invalidating each other's prebundles.
  cacheDir: resolve(__dirname, `../../node_modules/.vite-island-${process.env.JANUS_E2E_PORT ?? '41731'}`),
  resolve: {
    alias: {
      '@janusx/plugin-sdk': resolve(__dirname, '../../packages/plugin-sdk/src/index.ts'),
      '@': resolve(__dirname, '../../src/renderer/src'),
    },
  },
  plugins: [react()],
})
