import React from 'react'
import ReactDOM from 'react-dom/client'
import { openWorkspaceImport } from '../../../src/renderer/src/components/WorkspaceImport'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import type { WorkspaceCreateInput } from '../../../src/shared/ipc/workspace'
import type { WorkspaceRuntime } from '../../../src/shared/workspace-runtime'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'dark'
const fixture = {
  created: [] as WorkspaceCreateInput[],
  connections: [] as WorkspaceRuntime[],
  cancelLocal: false,
  failConnect: false,
  delay: 0,
  completed: false,
}
Object.assign(window, { workspaceImportFixture: fixture })
Object.assign(window.electron, {
  workspaceRuntime: {
    distributions: async () => params.has('empty') ? [] : ['Ubuntu', 'Debian'],
    hosts: async () => ['dev-server', 'staging'],
    connect: async (runtime: WorkspaceRuntime) => {
      fixture.connections.push(runtime)
      await new Promise(resolve => setTimeout(resolve, fixture.delay))
      if (fixture.failConnect) throw new Error('Could not connect to dev-server. Check your SSH configuration.')
      return { home: '/home/developer', platform: 'linux', architecture: 'x86_64', python: '3.12', git: true }
    },
    browse: async (_runtime: WorkspaceRuntime, path: string) => ({ path, entries: path === '/home/developer' ? [
      { name: 'projects', path: '/home/developer/projects', directory: true },
      { name: 'Documents', path: '/home/developer/Documents', directory: true },
      { name: '.config', path: '/home/developer/.config', directory: true },
      { name: 'readme.txt', path: '/home/developer/readme.txt', directory: false },
    ] : [] }),
    terminals: async () => [],
  },
})
Object.assign(window.electron.dialog, { openDirectory: async () => ({ canceled: fixture.cancelLocal, filePaths: fixture.cancelLocal ? [] : ['C:/Projects/JanusX'] }) })
Object.assign(window.electron.workspace, { create: async (input: WorkspaceCreateInput) => {
  fixture.created.push(input)
  return { ...input, id: 'fixture-workspace', clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: new Date().toISOString() }
} })

void initI18n().then(() => changeLanguage(params.get('lang') ?? 'en')).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <main style={{ height: '100vh', background: 'var(--shell-canvas)', color: 'var(--shell-text)', padding: 24 }}>
      <button onClick={() => void openWorkspaceImport().then(() => { fixture.completed = true })}>Add workspace</button>
    </main>,
  )
})
