import { defineConfig } from '@playwright/test'
import base from './playwright.blueprint.config'

export default defineConfig({
  ...base,
  projects: base.projects?.map(project => ({ ...project, testMatch: ['blueprint-local.spec.ts'] })),
})
