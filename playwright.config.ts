import { defineConfig } from '@playwright/test'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

const islandPort = Number(process.env.JANUS_E2E_PORT ?? 41731)

const desktopTestFiles = [
  'blueprint-plugin.spec.ts', 'desktop-workspace-runtime.spec.ts', 'desktop-plugins.spec.ts',
  'unified-file-window.spec.ts', 'desktop-cpa.spec.ts', 'desktop-smoke.spec.ts',
  'desktop-harness-runtime.spec.ts', 'desktop-session-continue.spec.ts', 'editor-definition.spec.ts',
  'editor-find-widget.spec.ts', 'editor-window-tabs.spec.ts', 'run-config-assistant.spec.ts',
  'memo-desktop.spec.ts', 'memo-layout-desktop.spec.ts', 'memo-chat-desktop.spec.ts',
]

// Note: disjoint browser/desktop suites — see .agents/notes/desktop/reproducible-verification.md
if (process.platform === 'win32') {
  const temp = realpathSync.native(tmpdir())
  process.env.TEMP = temp
  process.env.TMP = temp
}

// The health check must reach the local fixture server directly. An inherited
// HTTP proxy can return a page for an unused port and falsely report it as busy.
const loopbackProxyBypass = [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost', '::1']
  .filter(Boolean).join(',')
process.env.NO_PROXY = loopbackProxyBypass
process.env.no_proxy = loopbackProxyBypass

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  projects: [
    {
      name: 'island',
      testIgnore: [...desktopTestFiles, 'blueprint-local.spec.ts'],
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
      testMatch: desktopTestFiles,
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
