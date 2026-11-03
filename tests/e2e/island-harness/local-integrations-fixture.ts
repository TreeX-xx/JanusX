// Synthetic IPC data, used with the production settings panel. No native config writes.
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspace'
import type { LocalIntegrationCatalog, LocalIntegrationDocument, LocalIntegrationEntry, LocalIntegrationQuery, LocalIntegrationSource } from '../../../src/shared/local-integrations'

export function installLocalIntegrationsFixture() {
  const params = new URLSearchParams(location.search)
  useWorkspaceStore.setState({ workspaces: [{ id: 'demo', name: 'JanusX', path: 'C:\\Projects\\JanusX', clis: [], layout: { mode: 'tabs', positions: [] }, createdAt: '', updatedAt: '' }], activeWorkspaceId: 'demo' })
  const revisions = 'a'.repeat(64)
  const catalogs = new Map<string, LocalIntegrationCatalog>()
  const documents = new Map<string, string>()
  let pending: { query: LocalIntegrationQuery; id: string } | null = null
  let probes = 0
  const catalog = (query: LocalIntegrationQuery) => {
    const key = query.client + ':' + query.scope
    if (catalogs.has(key)) return catalogs.get(key)!
    const sources: LocalIntegrationSource[] = []
    const entries: LocalIntegrationEntry[] = []
    if (query.client === 'janus') {
      const id = 'plugin-skill'
      sources.push({ id, kind: 'skill', scope: 'plugin', path: 'C:\\Plugins\\blueprint', writable: false, exists: true, revision: revisions })
      entries.push({ id, sourceId: id, kind: 'skill', name: 'Blueprint review', description: 'Inspect a project blueprint', path: sources[0].path, scope: 'plugin', inherited: false, writable: false, state: 'discovered', pluginId: 'janus.blueprint' })
      documents.set(id, '# Blueprint review\n\nReview the current task.')
    } else {
      for (const scope of query.scope === 'user' ? ['user'] as const : ['user', 'workspace'] as const) {
        const root = scope === 'user' ? `C:\\Users\\Tree\\.${query.client}` : 'C:\\Projects\\JanusX\\.agents'
        for (const kind of ['skill', 'mcp'] as const) {
          const source: LocalIntegrationSource = { id: `${key}:${scope}:${kind}`, kind, scope, path: `${root}\\${kind === 'skill' ? 'skills' : 'config.toml'}`, exists: true, writable: true, revision: revisions }
          sources.push(source)
          const names = kind === 'skill' ? scope === 'user' ? ['code-review', 'frontend-design', 'debugging'] : ['project-conventions'] : scope === 'user' ? ['filesystem', 'context7'] : ['project-tools']
          names.forEach((name, index) => {
            const id = `${source.id}:${name}`
            const description = kind === 'skill' ? ['检查改动与回归风险，形成清晰的审阅意见。', '遵循项目设计语言，构建一致的界面体验。', '定位问题根因并验证修复。'][index] : index ? 'https://mcp.example.com/mcp' : 'node'
            entries.push({ id, sourceId: source.id, kind, name, description, path: kind === 'skill' ? `${source.path}\\${name}\\SKILL.md` : source.path, scope, inherited: query.scope === 'workspace' && scope === 'user', writable: true, state: kind === 'skill' ? 'discovered' : 'configured', ...(kind === 'mcp' ? { transport: index ? 'http' : 'stdio' } as const : {}) })
            documents.set(id, kind === 'skill' ? `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n先了解项目约定，审阅相关代码，再给出可验证的建议。` : JSON.stringify(index ? { url: 'https://mcp.example.com/mcp' } : { command: 'node', args: ['C:/Tools/mcp/server.js'] }, null, 2))
          })
        }
      }
    }
    const result = { sources, entries, scannedAt: new Date().toISOString(), limited: false }
    catalogs.set(key, result)
    return result
  }
  const read = async (query: LocalIntegrationQuery, id: string): Promise<LocalIntegrationDocument> => {
    const entry = catalog(query).entries.find(item => item.id === id)!
    return { entry: structuredClone(entry), content: documents.get(id)!, revision: revisions }
  }
  window.electron.localIntegrations = {
    scan: async query => structuredClone(catalog(query)),
    read,
    prepareRemoval: async (query, id) => {
      pending = { query, id }
      const entry = (await read(query, id)).entry
      return { token: 'fixture', entry, targetPath: entry.path, method: entry.kind === 'skill' ? 'trash' : 'config', expiresAt: Date.now() + 300000, fileCount: 2 }
    },
    remove: async () => {
      if (params.has('changed')) throw new Error('changed')
      const { query, id } = pending!
      const data = catalog(query), entry = data.entries.find(item => item.id === id)!
      data.entries = data.entries.filter(item => item.id !== id)
      pending = null
      return entry.kind === 'skill' ? { method: 'trash' } : { method: 'config', backupId: 'backup' }
    },
    revealBackup: async id => { document.documentElement.dataset.integrationBackup = id },
    save: async input => {
      document.documentElement.dataset.integrationSave = JSON.stringify(input)
      if (params.has('changed')) throw new Error('changed')
      const data = catalog(input.query)
      const source = data.sources.find(item => item.id === input.sourceId)!
      const id = input.entryId ?? `${source.id}:${input.name}`
      if (!input.entryId) data.entries.push({ id, sourceId: source.id, kind: source.kind, name: input.name, description: 'New resource', path: source.kind === 'skill' ? `${source.path}\\${input.name}\\SKILL.md` : source.path, scope: source.scope, inherited: false, writable: true, state: source.kind === 'skill' ? 'discovered' : 'configured' })
      documents.set(id, input.content)
      return read(input.query, id)
    },
    reveal: async (_query, id) => { document.documentElement.dataset.integrationReveal = id },
    probe: async () => { document.documentElement.dataset.integrationProbes = String(++probes); return { state: 'passed', checkedAt: new Date().toISOString(), durationMs: 138, tools: 6 } },
  }
}
