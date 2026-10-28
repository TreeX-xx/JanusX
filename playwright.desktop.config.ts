import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Note: isolated desktop acceptance does not start the island server — see .agents/notes/desktop/reproducible-verification.md
export default defineConfig({
  ...base,
  webServer: undefined,
  workers: 1,
  projects: base.projects?.filter(project => project.name === 'desktop'),
})
