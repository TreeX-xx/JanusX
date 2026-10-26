export interface HarnessWorkspaceStatus {
  state: 'ok' | 'empty' | 'not-found' | 'foreign' | 'invalid' | 'error'
  root: string
  projectId?: string
  noteCount: number
  diagnostics: Array<{ code: string; message: string; path?: string }>
}

export interface HarnessInitPreview {
  id: string
  root: string
  foreign: boolean
  files: Array<{ path: string; content: string }>
}
