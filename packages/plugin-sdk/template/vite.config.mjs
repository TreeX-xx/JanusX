import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { index: resolve('index.html'), summary: resolve('summary.html') } } },
})
