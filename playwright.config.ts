import { defineConfig } from '@playwright/test'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

const islandPort = Number(process.env.JANUS_E2E_PORT ?? 41731)

// Note: one path spelling across IPC and Monaco — see .agents/notes/2026-09-20-reproducible-verification.md
if (process.platform === 'win32') {
  const temp = realpathSync.native(tmpdir())
  process.env.TEMP = temp
  process.env.TMP = temp
}

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  projects: [
    {
      name: 'island',
      testIgnore: ['desktop-smoke.spec.ts', 'desktop-cpa.spec.ts', 'desktop-plugins.spec.ts', 'desktop-workspace-runtime.spec.ts', 'blueprint-plugin.spec.ts', 'blueprint-local.spec.ts'],
      timeout: 20_000,
      expect: { timeout: 5_000 },
      use: {
        baseURL: `http://127.0.0.1:${islandPort}`,
        viewport: { width: 1280, height: 720 },
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'desktop',
      testMatch: ['blueprint-plugin.spec.ts', 'desktop-workspace-runtime.spec.ts', 'desktop-plugins.spec.ts', 'unified-file-window.spec.ts', 'desktop-cpa.spec.ts', 'desktop-smoke.spec.ts', 'desktop-harness-runtime.spec.ts', 'desktop-session-continue.spec.ts', 'editor-definition.spec.ts', 'editor-find-widget.spec.ts', 'editor-window-tabs.spec.ts', 'blueprint-janus-capsule.spec.ts', 'blueprint-review-desktop.spec.ts', 'run-config-assistant.spec.ts', 'memo-desktop.spec.ts', 'memo-layout-desktop.spec.ts', 'memo-chat-desktop.spec.ts'],
      timeout: 90_000,
      expect: { timeout: 10_000 },
      use: {
        trace: 'retain-on-failure',
      },
    },
  ],
  webServer: {
    command: `npx vite --config tests/e2e/island-vite.config.ts --host 127.0.0.1 --port ${islandPort} --strictPort`,
    url: `http://127.0.0.1:${islandPort}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
