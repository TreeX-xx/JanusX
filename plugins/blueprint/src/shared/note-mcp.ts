export const NOTE_MCP_CLIENTS = ['claude-code', 'codex', 'opencode', 'janus', 'pi', 'dsh'] as const
export type NoteMcpClient = typeof NOTE_MCP_CLIENTS[number]
export interface NoteMcpClientStatus {
  id: NoteMcpClient
  label: string
  path: string
  hash: string
  state: 'absent' | 'current' | 'outdated' | 'conflict' | 'unverified' | 'unreadable'
}
export interface NoteMcpStatus { available: boolean; clients: NoteMcpClientStatus[] }
export interface NoteMcpChange { client: NoteMcpClient; expectedHash: string; action: 'import' | 'remove' }
export interface NoteMcpProbe { ok: boolean; tools: string[]; error?: string }
