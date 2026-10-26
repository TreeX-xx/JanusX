import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Native plugin pages load from janusx-plugin:, with no island Vite server.
// Keep the same desktop expectations and diagnostics as the application suite.
export default defineConfig({
  ...base,
  webServer: undefined,
  projects: base.projects?.filter(project => project.name === 'desktop').map(project => ({
    ...project, testMatch: ['blueprint-plugin.spec.ts'],
  })),
})
