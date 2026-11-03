// Note: .agents/notes/workbench/local-skills-mcp.md
export const LOCAL_INTEGRATION_CLIENTS = ['codex', 'claude', 'opencode', 'janus'] as const
export type LocalIntegrationClient = typeof LOCAL_INTEGRATION_CLIENTS[number]
export type LocalIntegrationKind = 'skill' | 'mcp'
export type LocalIntegrationScope = 'user' | 'workspace' | 'private' | 'plugin'
export interface LocalIntegrationQuery { client: LocalIntegrationClient; scope: 'user' | 'workspace'; workspaceId?: string }
export interface LocalIntegrationSource {
  id: string; kind: LocalIntegrationKind; scope: LocalIntegrationScope; path: string
  exists: boolean; writable: boolean; revision: string; issue?: string
}
export interface LocalIntegrationEntry {
  id: string; sourceId: string; kind: LocalIntegrationKind; name: string; description: string; path: string
  scope: LocalIntegrationScope; inherited: boolean; writable: boolean
  state: 'discovered' | 'configured' | 'disabled' | 'invalid' | 'duplicate'; issue?: string
  transport?: 'stdio' | 'http' | 'sse'; pluginId?: string
}
export interface LocalIntegrationCatalog {
  entries: LocalIntegrationEntry[]; sources: LocalIntegrationSource[]; scannedAt: string; workspacePath?: string
  limited: boolean
}
export interface LocalIntegrationDocument { entry: LocalIntegrationEntry; content: string; revision: string }
export interface LocalIntegrationSave {
  query: LocalIntegrationQuery; sourceId: string; entryId?: string; name: string; content: string; expectedRevision: string
}
export interface LocalIntegrationProbe {
  state: 'passed' | 'needs-auth' | 'failed' | 'unsupported'; checkedAt: string; durationMs: number; tools?: number; issue?: string
}
export const LOCAL_INTEGRATION_CHANNELS = {
  scan: 'local-integrations:scan', read: 'local-integrations:read', save: 'local-integrations:save',
  reveal: 'local-integrations:reveal', probe: 'local-integrations:probe',
} as const
export interface LocalIntegrationsAPI {
  scan(query: LocalIntegrationQuery): Promise<LocalIntegrationCatalog>
  read(query: LocalIntegrationQuery, entryId: string): Promise<LocalIntegrationDocument>
  save(input: LocalIntegrationSave): Promise<LocalIntegrationDocument>
  reveal(query: LocalIntegrationQuery, entryId: string): Promise<void>
  probe(query: LocalIntegrationQuery, entryId: string, expectedRevision: string): Promise<LocalIntegrationProbe>
}
