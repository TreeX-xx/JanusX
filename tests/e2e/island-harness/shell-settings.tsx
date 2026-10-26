import React from 'react'
import ReactDOM from 'react-dom/client'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { normalizeShellProfiles } from '../../../src/shared/shellProfiles'
import type { ExternalCliToolId, ExternalCliInstallOptions } from '../../../src/shared/ipc/external-cli'
import styles from '../../../src/renderer/src/components/AppSettingsModal.module.css'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'planche'
Object.assign(window.electron.system, { getLanguage: async () => 'zh-CN', setLanguage: async () => undefined })
Object.assign(window.electron.externalCli, {
  detect: async (toolId: string) => ({ toolId, installed: true, runnable: true, version: '1.0.0' }),
  latest: async (toolId: string) => ({ toolId, latestVersion: '1.0.0' }),
})
if (params.has('cliStates')) {
  const installed = new Set<ExternalCliToolId>(['janus', 'claude', 'opencode', 'pi'])
  const upgraded = new Set<ExternalCliToolId>()
  Object.assign(window.electron.externalCli, {
    detect: async (toolId: ExternalCliToolId) => ({
      toolId, installed: installed.has(toolId), runnable: installed.has(toolId) && toolId !== 'opencode',
      version: installed.has(toolId) ? upgraded.has(toolId) ? '2.0.0' : '1.0.0' : undefined,
      source: installed.has(toolId) ? 'path' : undefined,
    }),
    latest: async (toolId: ExternalCliToolId) => ({ toolId, latestVersion: toolId === 'claude' || upgraded.has(toolId) ? '2.0.0' : '1.0.0' }),
    install: async (toolId: ExternalCliToolId) => {
      installed.add(toolId); upgraded.add(toolId)
      return { toolId, success: true, version: '2.0.0' }
    },
  })
}
if (params.has('opencode')) {
  const scenario = params.get('opencode')
  let version = scenario === 'v2' ? '2.0.0' : scenario === 'v1-ready' ? '1.19.4' : '1.18.0'
  let installed = scenario !== 'missing'
  const requests: Array<{ toolId: ExternalCliToolId; options?: ExternalCliInstallOptions }> = []
  Object.assign(window, { cliInstallRequests: requests })
  const original = { ...window.electron.externalCli }
  Object.assign(window.electron.externalCli, {
    detect: async (toolId: ExternalCliToolId) => toolId !== 'opencode' ? original.detect(toolId) : ({
      toolId, installed, runnable: installed && scenario !== 'unknown',
      version: installed && scenario !== 'unknown' ? version : undefined, source: installed ? 'path' : undefined,
    }),
    latest: async (toolId: ExternalCliToolId) => toolId !== 'opencode' ? original.latest(toolId) : ({
      toolId, versions: scenario === 'offline' ? {} : scenario === 'v1-offline' ? { v2: '2.1.4' } : { v1: '1.19.4', v2: '2.1.4' },
    }),
    install: async (toolId: ExternalCliToolId, options?: ExternalCliInstallOptions) => {
      requests.push({ toolId, options })
      if (toolId !== 'opencode') return original.install(toolId, options)
      if (scenario === 'fail') return { toolId, success: false, error: 'Fixture download failed' }
      if (scenario === 'shadow') return { toolId, success: false, error: 'Check PATH: active command is still v1' }
      installed = true
      version = options!.version
      return { toolId, success: true, version }
    },
  })
}
let settings = normalizeShellProfiles({
  entries: params.has('empty') ? [] : [
    { id: 'powershell', name: 'PowerShell', command: 'powershell.exe', visible: true, isDefault: true },
    { id: 'bash', name: 'Git Bash', command: '"C:\\Program Files\\Git\\bin\\bash.exe"', suffix: '--login -i', visible: true },
    { id: 'ssh', name: 'Remote development', command: 'ssh developer@development.example.com', visible: false },
  ],
  hiddenCliPresets: [],
})
Object.assign(window.electron.shellProfiles, {
  list: async () => settings,
  save: async (next: unknown) => {
    if (params.has('fail')) throw new Error('Fixture save failure')
    settings = normalizeShellProfiles(next)
    return settings
  },
  detect: async () => [],
})
await initI18n()
await changeLanguage(params.has('en') ? 'en' : 'zh-CN')
const { useShellProfilesStore } = await import('../../../src/renderer/src/stores/shell-profiles')
await useShellProfilesStore.getState().load()
const { TerminalManagerPanel } = await import('../../../src/renderer/src/components/TerminalManagerPanel')
ReactDOM.createRoot(document.getElementById('root')!).render(
  <main className={styles.panel} style={{ display: 'block', width: 'min(800px, calc(100% - 32px))', height: 'auto', margin: '24px auto', padding: 22 }}>
    <TerminalManagerPanel />
  </main>,
)
