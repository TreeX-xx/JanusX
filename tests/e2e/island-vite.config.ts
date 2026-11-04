import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path'
import { pdfAssets } from '../../scripts/pdf-assets'

export default defineConfig({
  root: resolve(__dirname, 'island-harness'),
  // Keep simultaneous harnesses and the desktop dev server from invalidating each other's prebundles.
  cacheDir: resolve(__dirname, `../../node_modules/.vite-island-${process.env.JANUS_E2E_PORT ?? '41731'}`),
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@janusx/plugin-sdk/theme.css': resolve(__dirname, '../../packages/plugin-sdk/theme.css'),
      '@janusx/plugin-sdk': resolve(__dirname, '../../packages/plugin-sdk/src/index.ts'),
      '@': resolve(__dirname, '../../src/renderer/src'),
    },
  },
  plugins: [react(), pdfAssets()],
})
