import type { AgentEngine } from './janus-runner'

export const CHECKPOINT_CHANNELS = {
  create: 'checkpoint:create',
  finalize: 'checkpoint:finalize',
  restore: 'checkpoint:restore',
  list: 'checkpoint:list',
  diff: 'checkpoint:diff',
  diffAll: 'checkpoint:diff:all',
  records: 'checkpoint:records',
  delete: 'checkpoint:delete',
  clearAll: 'checkpoint:clearAll',
  event: 'checkpoint:event',
  ready: 'checkpoint:ready',
} as const

export type CheckpointEngine = AgentEngine | 'shell' | 'manual' | 'janus' | 'pi' | 'dsh'

export interface CheckpointSummary {
  id: string
  terminalId: string
  engine: string
  conversationIndex: number
  createdAt: string
  branch: string
  prompt: string
  fileCount: number
  changedFileCount: number | null
  status: 'ready'
  sessionId?: string
}

export type ChangedFileStatus = 'added' | 'deleted' | 'modified' | 'binary' | 'oversized'

export interface ChangedFileRecord {
  path: string
  status: ChangedFileStatus
  additions: number | null
  deletions: number | null
  size: number
}

export interface RestoreScope {
  sessionId?: string
  terminalId?: string
}

export interface CheckpointConflict {
  filePath: string
  resolution: 'snapshot'
}

export interface CheckpointFilter { terminalId?: string; engine?: string; cwd?: string; sessionId?: string }
export interface CheckpointCreateInput {
  terminalId: string
  engine: string
  prompt: string
  cwd: string
  sessionId?: string
  turnId?: string
  kind?: 'done' | 'failed' | 'interrupted'
  worktreeId?: string
  parentId?: string
}

export interface CheckpointAPI {
  create(input: CheckpointCreateInput): Promise<CheckpointSummary>
  finalize(checkpointId: string, cwd: string): Promise<{ success: boolean }>
  restore(checkpointId: string, cwd: string, scope?: RestoreScope): Promise<{ conflicts: CheckpointConflict[] }>
  list(filter?: CheckpointFilter): Promise<CheckpointSummary[]>
  diff(checkpointId: string, filePath: string, cwd: string): Promise<string>
  diffAll(checkpointId: string, cwd: string): Promise<string>
  records(checkpointId: string, cwd: string): Promise<ChangedFileRecord[]>
  delete(checkpointId: string, cwd?: string): Promise<{ success: boolean }>
  clearAll(cwd?: string): Promise<{ success: boolean }>
  onEvent(callback: (payload: { type?: string; error?: string }) => void): () => void
  onReady(callback: (payload: { terminalId: string; success: boolean; error?: string }) => void): () => void
}
