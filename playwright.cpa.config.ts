import { defineConfig } from '@playwright/test'
import base from './playwright.desktop.config'
export default defineConfig({ ...base, projects: base.projects?.map(project => ({ ...project, testMatch: ['cpa-plugin.spec.ts'] })) })
