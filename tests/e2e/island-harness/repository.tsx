import React from 'react'
import ReactDOM from 'react-dom/client'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { RightDock } from '../../../src/renderer/src/components/right-tools/RightDock'
import { installElectronApiFallback } from '../../../src/renderer/src/lib/electron-api-fallback'
import { initI18n, changeLanguage } from '../../../src/renderer/src/i18n'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import { useWorktreeStore } from '../../../src/renderer/src/stores/worktree'
import { useRightToolStore } from '../../../src/renderer/src/stores/right-tools'
import { useAppStore } from '../../../src/renderer/src/stores/app'
import { useThemeStore } from '../../../src/renderer/src/stores/theme'
import { useExperimentalStore } from '../../../src/renderer/src/stores/experimental'
import { DEFAULT_REPOSITORY_VIEW, useHostedStore } from '../../../src/renderer/src/stores/hosted'
import type { HostedDetail, HostedItemKind, HostedMutation, HostedQuery, HostedTarget } from '../../../src/shared/ipc/hosted'
import '../../../src/renderer/src/styles/globals.css'
import '../../../src/renderer/src/styles/themes.generated.css'

installElectronApiFallback()
const params = new URLSearchParams(location.search)
const provider = params.has('gitlab') ? 'gitlab' : 'github'
const language = params.has('zh') ? 'zh-CN' : 'en'
const host = provider + '.com'
const workspaces = ['Alpha', 'Beta'].map((name, index) => ({ id: 'repo-' + index, name, path: 'C:/fixtures/' + name, clis: [], layout: { mode: 'tabs' as const, positions: [] }, createdAt: '2026-11-03T00:00:00Z' }))
const fixture = { authorized: !params.has('login'), failRead: params.has('error'), failWrite: false, started: [] as string[], stopped: [] as string[], inputs: [] as string[], writes: [] as HostedMutation[], reads: [] as HostedQuery[], release: () => {}, authorize: () => { fixture.authorized = true } }
const overrides = new Map<string, Partial<HostedDetail>>()
const imageReads: string[] = []
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420"><rect width="960" height="420" rx="24" fill="#263742"/><rect x="60" y="140" width="220" height="140" rx="12" fill="#6e9a98"/><rect x="370" y="140" width="220" height="140" rx="12" fill="#b4c8b8"/><rect x="680" y="140" width="220" height="140" rx="12" fill="#e2cc9d"/><path d="M280 210h90m220 0h90" stroke="#fff" stroke-width="8"/><text x="60" y="80" fill="white" font-family="sans-serif" font-size="32">Repository workflow</text></svg>'
Object.assign(fixture, { imageReads, failImage: params.has('image-error') })
const comments: Record<number, string[]> = {}
const repoName = (path: string) => path.endsWith('Beta') ? 'Beta' : 'Alpha'
const makeItem = (path: string, kind: HostedItemKind, number: number): HostedDetail => ({
  kind, number, title: repoName(path) + (kind === 'issue' ? ' issue ' : ' review ') + number,
  body: '## Background\n\nKeep repository actions close to the work.\n\n- Preserve workspace context\n- Show clear status\n\n`literal code`',
  state: 'open', author: 'tree', labels: ['enhancement', 'workbench'], url: 'https://' + host + '/team/' + repoName(path) + '/issues/' + number,
  updatedAt: '2026-11-03T12:00:00Z', assignees: ['maintainer'], checks: kind === 'review' ? [{ name: 'Unit tests', state: 'pass' }] : [],
  ...(kind === 'review' ? { head: 'feature/repository', base: 'main', sha: 'a'.repeat(40) } : {}), ...overrides.get(kind + ':' + number),
})
Object.assign(window.electron.hosted, {
  image: async (_target: HostedTarget, path: string) => {
    imageReads.push(path)
    if ((fixture as typeof fixture & { failImage: boolean }).failImage) throw Error('Image request failed')
    return 'data:image/svg+xml;base64,' + btoa(imageSvg)
  },
  overview: async (target: HostedTarget) => {
    if (fixture.failRead) throw Error('Network unavailable')
    if (params.has('images')) return { description: 'README image preview', defaultBranch: 'main', visibility: 'private', readme: { path: 'README.md', url: 'https://' + host + '/team/' + repoName(target.workspacePath) + (provider === 'github' ? '/blob/' : '/-/blob/') + 'main/README.md', text: '# Images\n\n![Architecture](docs/architecture.svg)\n\n![External badge](https://images.example.test/badge.svg)\n\n' + Array.from({ length: 80 }, (_, i) => 'Paragraph ' + i + '\n\n').join('') + '![Later image](docs/later.svg)' } }
    return { description: 'A focused workspace for thoughtful software development.', defaultBranch: 'main', visibility: params.has('gitlab') ? 'private' : 'public',
      readme: params.has('no-readme') ? null : { text: '# ' + repoName(target.workspacePath) + '\n\nKeep your work, discussions and reviews together.\n\n## Getting started\n\n```sh\nnpm install\nnpm run dev\n```\n\n## Resources\n\n- [Setup guide](docs/setup.md)\n- [Project website](https://example.com)\n\n| Command | Purpose |\n| --- | --- |\n| dev | Start the workspace |\n| test | Check your changes |\n\n![Project diagram](docs/diagram.png)', path: 'README.md', url: 'https://' + host + '/team/' + repoName(target.workspacePath) + '/blob/main/README.md' } }
  },
  repository: async (path: string) => ({ key: provider + ':team/' + repoName(path), provider, fullName: 'team/' + repoName(path), url: 'https://' + host + '/team/' + repoName(path), remote: 'origin' }),
  connection: async () => ({ provider, status: params.has('missing') ? 'cli-missing' : fixture.authorized ? 'ready' : 'unauthenticated' }),
  browse: async (target: HostedTarget, query: HostedQuery) => {
    fixture.reads.push(query)
    if (query.search === 'slow') await new Promise<void>(resolve => { fixture.release = resolve })
    if (fixture.failRead) throw Error('Network unavailable')
    const start = query.page === 1 ? 1 : 21
    return { items: Array.from({ length: query.page === 1 ? 20 : 1 }, (_, i) => makeItem(target.workspacePath, query.kind, start + i)), nextPage: query.page === 1 ? 2 : null }
  },
  detail: async (target: HostedTarget, kind: HostedItemKind, number: number) => makeItem(target.workspacePath, kind, number),
  discussion: async (_target: HostedTarget, _kind: HostedItemKind, number: number) => ({ items: (comments[number] ?? ['Ready for review.']).map((body, index) => ({ id: String(index), body, author: 'maintainer', createdAt: '2026-11-03T12:30:00Z' })), nextPage: null }),
  mutate: async (_target: HostedTarget, mutation: HostedMutation) => {
    fixture.writes.push(mutation)
    if (!fixture.authorized) throw Error('HTTP 401 Unauthorized')
    if (fixture.failWrite) throw Error('Write denied')
    const number = mutation.action === 'create' ? 999 : mutation.number
    if (mutation.action === 'comment') comments[number] = [...comments[number] ?? [], mutation.body]
    if (mutation.action === 'edit' || mutation.action === 'create') overrides.set(mutation.kind + ':' + number, { title: mutation.title, body: mutation.body })
    if (mutation.action === 'close' || mutation.action === 'reopen' || mutation.action === 'merge') overrides.set(mutation.kind + ':' + number, { ...overrides.get(mutation.kind + ':' + number), state: mutation.action === 'close' ? 'closed' : mutation.action === 'merge' ? 'merged' : 'open' })
    return { number }
  },
  loginStart: async (path: string) => { fixture.started.push(path); return { id: 'login-fixture', provider, output: '', finished: false } },
  loginRead: async () => ({ id: 'login-fixture', provider, output: 'One-time code: ABCD-1234\r\nPress Enter to open the browser.\r\n', finished: fixture.authorized, exitCode: fixture.authorized ? 0 : undefined }),
  loginInput: async (_id: string, data: string) => { fixture.inputs.push(data) },
  loginStop: async (id: string) => { fixture.stopped.push(id) },
})
useThemeStore.getState().applyExternal(params.get('theme') ?? 'dark')
const counts = { overview: 0, detail: 0, discussion: 0, connection: 0, image: 0, browse: 0 }
const heldReads: Array<() => void> = []
const cacheFixture = Object.assign(fixture, { counts, holdReads: false, failDetail: false, resetSession: () => useHostedStore.getState().authorized(), releaseReads: () => { cacheFixture.holdReads = false; heldReads.splice(0).forEach(resolve => resolve()) } })
for (const name of Object.keys(counts) as Array<keyof typeof counts>) {
  const original = window.electron.hosted[name] as (...args: unknown[]) => Promise<unknown>
  Object.assign(window.electron.hosted, { [name]: async (...args: unknown[]) => {
    counts[name]++
    if (cacheFixture.holdReads && name !== 'connection') await new Promise<void>(resolve => heldReads.push(resolve))
    if (name === 'detail' && cacheFixture.failDetail) throw Error('HTTP 401 Unauthorized')
    return original(...args)
  } })
}
useAppStore.setState({ sidebarCollapsed: false })
useExperimentalStore.setState({ teamCollab: false, loaded: true })
Object.assign(window.electron.system, { getLanguage: async () => language, setLanguage: async () => undefined })
Object.assign(window.electron.workspace, { update: async () => undefined })
Object.assign(window.electron.fileTree, { load: async () => [] })
const worktrees = Object.fromEntries(workspaces.map(workspace => [workspace.id, [
  { id: workspace.id + '-main', workspaceId: workspace.id, path: workspace.path, branch: 'main', isMain: true, detached: false, external: false },
  { id: workspace.id + '-feature', workspaceId: workspace.id, path: workspace.path + '-feature', branch: 'feature/repository', isMain: false, detached: false, external: false },
]]))
Object.assign(window.electron.worktree, { list: async (id: string) => worktrees[id], unwatch: async () => undefined })
useWorktreeStore.setState({ identities: Object.fromEntries(workspaces.map(workspace => [workspace.path, { host, owner: 'team', repo: workspace.name, avatarUrl: null }])), worktreesByWorkspace: worktrees, activePaths: Object.fromEntries(workspaces.map(workspace => [workspace.id, workspace.path + '-feature'])) })
useWorkspaceStore.setState({ workspaces, activeWorkspaceId: workspaces[0].id, terminals: [], activeTerminalId: null })
// Existing collaboration scenarios resume an Issues view; overview scenarios exercise the default.
if (!params.has('overview')) useHostedStore.setState({ views: Object.fromEntries(workspaces.map(workspace => [workspace.path, { ...DEFAULT_REPOSITORY_VIEW, tab: 'issue' }])) })
Object.assign(window, { repositoryFixture: fixture })
await initI18n(); await changeLanguage(language)
if (!params.has('login')) useRightToolStore.getState().openTool('repository')
if (params.has('minimum')) useRightToolStore.getState().setPanelWidth(340, 'repository')
function Preview() {
  const collapsed = useAppStore(state => state.panelCollapsed)
  return <main style={{ display: 'flex', height: '100vh', background: 'var(--shell-canvas)', color: 'var(--shell-text)' }}>
    <style>{'.workspace-sidebar { width: 252px; }'}</style><Sidebar />
    <div style={{ flex: 1, minWidth: 0, padding: 24, color: 'var(--shell-dim)' }}>Workspace</div>
    <RightDock effectiveCollapsed={collapsed} effectiveMaxWidth={520} forcedCollapsed={false} onResizingChange={() => {}} />
  </main>
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />)
