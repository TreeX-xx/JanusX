export const WORKSPACE_STORAGE_CHANNELS = {
  list: 'workspace-storage:list', migrate: 'workspace-storage:migrate',
  dismiss: 'workspace-storage:dismiss',
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
}
