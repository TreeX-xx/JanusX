// Note: .agents/notes/workbench/unified-file-window.md
export type FileViewType = 'code' | 'markdown' | 'html' | 'image' | 'binary'
export interface FileViewState {
  /** Qualified plugin viewer ID, or builtin; independent of the default preference. */
  viewerId?: string
  previewMode?: 'editor' | 'split' | 'preview'
  viewport?: string
  zoom?: string
  scrollTop?: number
  scrollLeft?: number
  cursor?: { lineNumber: number; column: number }
}
export interface OpenFile {
  id: string
  name: string
  path: string
  absolutePath: string
  viewType: FileViewType
  content: string
  base64?: string
  mimeType?: string
  size?: number
  mtime?: number
  isDirty: boolean
  isLoading: boolean
  error?: string
  externalChanged?: boolean
  /** Plugin drafts retain the disk baseline after fallback, scope changes and detach. */
  saveVersion?: string
  saveConflict?: boolean
  conflictDisk?: { text: string; version: string }
  pluginDraftViewer?: string
  pluginDraftSession?: boolean
  draftRevision?: number
  viewState?: FileViewState
}
export interface EditorSession { files: OpenFile[]; activeFileId: string | null }
export interface EditorOpenRequest {
  filePath?: string
  workspacePath?: string
  /** Explicit whole-session detach. Ordinary opens follow the existing host. */
  floating?: boolean
  session?: EditorSession
  content?: string
  isDirty?: boolean
}
export interface EditorDelivery extends EditorOpenRequest { requestId?: string }
export interface EditorOpenResult { success?: boolean; error?: string }
