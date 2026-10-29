export const WORKSPACE_STORAGE_CHANNELS = {
  list: 'workspace-storage:list', migrate: 'workspace-storage:migrate',
  dismiss: 'workspace-storage:dismiss',
  data: 'workspace-storage:data', measure: 'workspace-storage:measure', cleanup: 'workspace-storage:cleanup',
  relocate: 'workspace-storage:relocate', restore: 'workspace-storage:restore',
  retireHooks: 'workspace-storage:retire-hooks',
} as const
export interface WorkspaceMigrationItem {
  id: string
  name: string
  source: string
  target: string
  status: 'pending' | 'new' | 'migrated' | 'cleanup-pending' | 'offline' | 'unsupported' | 'failed'
  categories: string[]
  error?: string
}
export interface WorkspaceMigrationView {
  root: string
  prompt: boolean
  items: WorkspaceMigrationItem[]
}
export interface WorkspaceStorageAPI {
  list(): Promise<WorkspaceMigrationView>
  migrate(ids: string[]): Promise<WorkspaceMigrationItem[]>
  dismiss(): Promise<void>
  data(): Promise<WorkspaceDataItem[]>
  measure(id: string): Promise<number>
  cleanup(id: string, category: WorkspaceCleanupCategory): Promise<void>
  relocate(id: string, destination: string): Promise<void>
  restore(id: string): Promise<void>
  retireHooks(): Promise<LegacyHookCleanupResult>
}

export interface LegacyHookCleanupResult {
  commands: number
  files: string[]
  retained: Array<{ path: string; reason: string }>
}

export interface WorkspaceDataRecord { id: string; name: string; path: string }
export type WorkspaceCleanupCategory = 'logs' | 'checkpoints' | 'all'
export interface WorkspaceDataItem {
  id: string; name: string; path: string; target: string; workspaceIds: string[]; legacy: boolean
  status: 'associated' | 'offline' | 'detached' | 'purging' | 'failed'
  detachedAt?: string; expiresAt?: string; error?: string
}
