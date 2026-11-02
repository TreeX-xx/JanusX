import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { CLITerminal } from '../../../src/renderer/src/components/CLITerminal'
import { LocalCliSetup } from '../../../src/renderer/src/components/LocalCliSetup'
import { TerminalInstallBadge } from '../../../src/renderer/src/components/ui/TerminalInstallBadge'
import { TerminalPresetIcon } from '../../../src/renderer/src/components/ui/TerminalPresetIcon'
import { TerminalSelector } from '../../../src/renderer/src/components/TerminalSelector'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { launchTerminalPreset, retryTerminalCreate } from '../../../src/renderer/src/lib/terminal-launch'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { changeLanguage, initI18n } from '../../../src/renderer/src/i18n'
import type { TerminalCreateRequest, TerminalDataEvent } from '../../../src/shared/ipc/terminal'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
const remote = new URLSearchParams(location.search).get('remote')
const detections: (() => void)[] = []
const local = { installed: !new URLSearchParams(location.search).has('localCli'), installs: 0, fail: false, delayed: false, links: [] as string[], complete: () => {},
  detecting: new URLSearchParams(location.search).has('delayDetect'),
  completeDetection: () => { local.detecting = false; detections.splice(0).forEach(resolve => resolve()) },
}
Object.assign(window, { localCliFixture: local })
Object.assign(window.electron.file, { openPreviewLink: async (url: string) => { local.links.push(url) } })
Object.assign(window.electron.externalCli, {
  detect: async (toolId: string) => {
    if (local.detecting) await new Promise<void>(resolve => detections.push(resolve))
    return { toolId, installed: local.installed, runnable: local.installed, version: local.installed ? '1.0.0' : undefined }
  },
  install: async (toolId: string) => {
    local.installs++
    if (local.delayed) await new Promise<void>(resolve => { local.complete = resolve })
    if (local.fail) return { toolId, success: false, error: 'Fixture network failure' }
    local.installed = true
    return { toolId, success: true }
  },
})
const cliFixture = { installed: false, installs: 0, detectCalls: 0, state: 'running', fail: false, statusFail: false }
if (remote) {
  useWorkspaceStore.setState({ workspaces: [{ id: 'ws', name: 'Remote project', path: 'janusx-workspace://ws/project',
    runtime: remote === 'wsl' ? { kind: 'wsl', distro: 'Ubuntu', root: '/project' } : { kind: 'ssh', host: 'dev-server', root: '/project' },
    clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '', updatedAt: '' }] })
  Object.assign(window.electron, { workspaceRuntime: {
    detectCli: async () => { cliFixture.detectCalls++; return { installed: cliFixture.installed, environment: 'dev@linux', platform: 'linux', architecture: 'x86_64' } },
    installCli: async () => { cliFixture.installs++; if (cliFixture.fail) throw new Error('Target download failed'); return { state: cliFixture.state } },
    cliInstallStatus: async () => { if (cliFixture.statusFail) throw new Error('Empty status response'); if (cliFixture.state === 'complete') cliFixture.installed = true; return { state: cliFixture.state, log: 'Installing Agent package…' } },
  } })
}
Object.assign(window, { remoteCliFixture: cliFixture })
Object.assign(window.electron.system, { getLanguage: async () => 'en', getDefaultShell: async () => 'powershell.exe' })
useThemeStore.getState().applyExternal(new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'planche')
useWorkspaceStore.setState({ activeWorkspaceId: 'ws', terminals: [], activeTerminalId: null, paneTree: null })
const listeners = new Set<(event: TerminalDataEvent) => void>()
let ready: (() => void) | undefined
let fail: (() => void) | undefined
let sequence = 0
let replay = ''
Object.assign(window.electron.terminal, {
  create: (_request: TerminalCreateRequest) => new Promise<{ pid: number }>((resolve, reject) => {
    ready = () => resolve({ pid: 42 })
    fail = () => reject(new Error('Test startup failure'))
  }),
  replay: async () => ({ data: replay, seq: sequence }),
  onData: (callback: (event: TerminalDataEvent) => void) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  },
})
Object.assign(window, {
  startupFixture: {
    pending: () => Boolean(ready),
    ready: () => ready?.(),
    fail: () => fail?.(),
    output: (data: string) => {
      replay += data
      const id = useWorkspaceStore.getState().activeTerminalId!
      for (const listener of listeners) listener({ id, data, seq: ++sequence })
    },
    changeLanguage,
  },
})

function Harness() {
  const id = useWorkspaceStore(state => state.activeTerminalId)
  const [generation, setGeneration] = useState(0)
  const start = (preset: 'shell' | 'codex') => {
    ready = undefined
    replay = ''
    sequence = 0
    void launchTerminalPreset({ preset, workspaceId: 'ws', workspacePath: remote ? 'janusx-workspace://ws/project' : 'C:/fixture' })
  }
  return <>
    <button onClick={() => start('shell')}>New Shell</button>
    <button style={{ position: 'relative', paddingRight: 20 }} onClick={() => start('codex')}>{!remote && <><TerminalPresetIcon preset="codex" style={{ width: 22, height: 22 }} /><TerminalInstallBadge preset="codex" compact /></>}New Codex</button>
    <LocalCliSetup />
    <button onClick={() => setGeneration(value => value + 1)}>Remount</button>
    <button onClick={() => { if (id) void retryTerminalCreate(id) }}>Retry</button>
    <div style={{ position: 'relative', height: 'calc(100vh - 40px)' }}>
      {!id && new URLSearchParams(location.search).has('selector') && <TerminalSelector />}
      {id && <CLITerminal key={`${id}:${generation}`} terminalId={id} focused />}
    </div>
  </>
}
await initI18n()
await changeLanguage('en')
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>)
