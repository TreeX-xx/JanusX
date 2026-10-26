import type { WorkspaceRuntime } from '../workspace-runtime'

export const WORKSPACE_CHANNELS = {
  initialize: 'app:init',
  list: 'workspace:list',
  load: 'workspace:load',
  create: 'workspace:create',
  update: 'workspace:update',
  delete: 'workspace:delete',
} as const

export const FILE_TREE_CHANNELS = {
  load: 'filetree:load',
  children: 'filetree:children',
  createFile: 'filetree:create-file',
  createDirectory: 'filetree:create-directory',
  rename: 'filetree:rename',
  move: 'filetree:move',
  delete: 'filetree:delete',
  reveal: 'filetree:reveal',
  changed: 'filetree:changed',
} as const

export const FILE_CHANNELS = {
  read: 'file:read',
  save: 'file:save',
  readBinary: 'file:readBinary',
  stat: 'file:stat',
  openHtmlPreview: 'file:html-preview:open', updateHtmlPreview: 'file:html-preview:update', closeHtmlPreview: 'file:html-preview:close',
  openPreviewLink: 'file:preview:open-link',
} as const

export interface CLIConfig {
  id: string
  type: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface LayoutPosition {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutConfig {
  mode: 'grid' | 'tabs'
  positions: LayoutPosition[]
}

export type TerminalPreset = 'shell' | 'claude' | 'codex' | 'opencode' | 'janus' | 'pi' | 'dsh'

export interface WorkspaceSidebarGroup {
  id: string
  name: string
}

export interface Workspace {
  id: string
  name: string
  path: string
  runtime?: WorkspaceRuntime
  clis: CLIConfig[]
  layout: LayoutConfig
  lastTerminalType?: TerminalPreset
  sidebarOrder?: number
  sidebarGroup?: WorkspaceSidebarGroup
  createdAt: string
  updatedAt: string
}

export type AppLoadState = 'no-workspace' | 'workspace-loaded' | 'no-terminal' | 'terminal-active'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  /** True when Git ignores this entry; ignored entries remain actionable in the tree. */
  isGitIgnored?: boolean
  children?: FileNode[]
  hasChildren?: boolean
  loaded?: boolean
}

export interface WorkspaceCreateInput {
  name: string
  path: string
  runtime?: WorkspaceRuntime
}

export type WorkspaceUpdates = Record<string, unknown>

export interface WorkspaceInitResult {
  loadState: AppLoadState
  workspaces: Workspace[]
  activeWorkspaceId: string | null
}

export interface OperationResult {
  success: boolean
  error?: string
  path?: string
}

export interface FileReadResult {
  version?: string
  content?: string
  encoding?: 'utf-8'
  size?: number
  mtime?: number
  error?: string
}

export interface FileBinaryResult {
  base64?: string
  mimeType?: string
  size?: number
  mtime?: number
  error?: string
}

export interface FileStatResult {
  size?: number
  mtime?: number
  isFile?: boolean
  error?: string
}

export interface FileSaveResult {
  current?: { text: string; version: string }
  success?: boolean
  error?: string
  conflict?: boolean
  version?: string
}

export interface WorkspaceAPI {
  initialize(): Promise<WorkspaceInitResult>
  list(): Promise<Workspace[]>
  load(id: string): Promise<Workspace>
  create(input: WorkspaceCreateInput): Promise<Workspace>
  update(id: string, updates: WorkspaceUpdates): Promise<Workspace>
  delete(id: string): Promise<{ success: boolean }>
}

export interface FileTreeAPI {
  load(rootPath: string): Promise<FileNode[]>
  children(rootPath: string, relativePath: string): Promise<FileNode[]>
  createFile(rootPath: string, parentRelativePath: string, name: string): Promise<OperationResult>
  createDirectory(rootPath: string, parentRelativePath: string, name: string): Promise<OperationResult>
  rename(rootPath: string, relativePath: string, name: string): Promise<OperationResult>
  move(rootPath: string, sourceRelativePath: string, targetDirectoryRelativePath: string): Promise<OperationResult>
  delete(rootPath: string, relativePath: string): Promise<OperationResult>
  reveal(rootPath: string, relativePath: string): Promise<OperationResult>
  onChanged(callback: (payload: { workspacePath: string; changedFilePath?: string | null }) => void): () => void
}

export interface HtmlPreviewRequest { workspacePath: string; documentPath: string; content: string }
export interface HtmlPreviewLease { id: string; url: string }

export interface FileAPI {
  openPreviewLink(url: string): Promise<void>
  openHtmlPreview(request: HtmlPreviewRequest): Promise<HtmlPreviewLease>
  updateHtmlPreview(id: string, content: string): Promise<void>
  closeHtmlPreview(id: string): Promise<void>
  read(filePath: string): Promise<FileReadResult>
  save(filePath: string, content: string, expectedVersion?: string): Promise<FileSaveResult>
  readBinary(filePath: string): Promise<FileBinaryResult>
  stat(filePath: string): Promise<FileStatResult>
}
