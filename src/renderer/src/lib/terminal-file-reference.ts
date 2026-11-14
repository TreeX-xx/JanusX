export const WORKSPACE_FILE_DRAG_TYPE = 'application/x-janusx-workspace-file'
export const TERMINAL_DRAG_TYPE = 'application/x-janusx-terminal-id'
export const BROWSER_TAB_DRAG_TYPE = 'application/x-janusx-browser-surface-id'

let activeTerminalDragId: string | null = null
let activeBrowserTabDragSurfaceId: string | null = null
let activeWorkspaceFileDragPayload: WorkspaceFileDragPayload | null = null

export interface WorkspaceFileDragPayload {
  quote?: string
  type: 'file' | 'directory'
  name: string
  path: string
  workspacePath: string
}

export function setWorkspaceFileDragData(
  dataTransfer: DataTransfer,
  payload: WorkspaceFileDragPayload
): void {
  const normalizedPayload = {
    ...payload,
    path: normalizeWorkspaceFilePath(payload.path),
  }

  activeWorkspaceFileDragPayload = normalizedPayload
  dataTransfer.effectAllowed = payload.type === 'file' ? 'copyMove' : 'copy'
  dataTransfer.setData(WORKSPACE_FILE_DRAG_TYPE, JSON.stringify(normalizedPayload))
  dataTransfer.setData('text/plain', formatTerminalFileReference(normalizedPayload.path).trim())
}

export function hasWorkspaceFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(WORKSPACE_FILE_DRAG_TYPE)
}

export function getActiveWorkspaceFileDragData(): WorkspaceFileDragPayload | null {
  return activeWorkspaceFileDragPayload
}

export function clearWorkspaceFileDragData(): void {
  activeWorkspaceFileDragPayload = null
}

export function setTerminalDragData(dataTransfer: DataTransfer, terminalId: string): void {
  activeTerminalDragId = terminalId
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(TERMINAL_DRAG_TYPE, terminalId)
}

export function hasTerminalDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(TERMINAL_DRAG_TYPE)
}

export function readTerminalDragData(dataTransfer: DataTransfer): string | null {
  return dataTransfer.getData(TERMINAL_DRAG_TYPE) || null
}

export function getActiveTerminalDragId(): string | null {
  return activeTerminalDragId
}

export function clearTerminalDragData(terminalId?: string): void {
  if (!terminalId || activeTerminalDragId === terminalId) {
    activeTerminalDragId = null
  }
}

/*-- 浏览器 pane tab 拖拽（分屏/移动），与 terminal 拖拽同一套 dataTransfer + 模块级兜底机制 --*/
export function setBrowserTabDragData(dataTransfer: DataTransfer, surfaceId: string): void {
  activeBrowserTabDragSurfaceId = surfaceId
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(BROWSER_TAB_DRAG_TYPE, surfaceId)
}

export function hasBrowserTabDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(BROWSER_TAB_DRAG_TYPE)
}

export function readBrowserTabDragData(dataTransfer: DataTransfer): string | null {
  return dataTransfer.getData(BROWSER_TAB_DRAG_TYPE) || null
}

export function getActiveBrowserTabDragId(): string | null {
  return activeBrowserTabDragSurfaceId
}

export function clearBrowserTabDragData(surfaceId?: string): void {
  if (!surfaceId || activeBrowserTabDragSurfaceId === surfaceId) {
    activeBrowserTabDragSurfaceId = null
  }
}

export function readWorkspaceFileDragData(dataTransfer: DataTransfer): WorkspaceFileDragPayload | null {
  const raw = dataTransfer.getData(WORKSPACE_FILE_DRAG_TYPE)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceFileDragPayload>
    if (
      (parsed.type !== 'file' && parsed.type !== 'directory') ||
      typeof parsed.path !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.workspacePath !== 'string'
    ) {
      return null
    }

    return {
      type: parsed.type,
      name: parsed.name,
      path: normalizeWorkspaceFilePath(parsed.path),
      workspacePath: parsed.workspacePath,
      quote: typeof parsed.quote === 'string' ? parsed.quote : undefined,
    }
  } catch {
    return null
  }
}

export function formatTerminalFileReference(path: string): string {
  const normalized = normalizeWorkspaceFilePath(path)
  if (!normalized) return ''

  if (/\s/.test(normalized)) {
    return `@"${normalized.replace(/["\\]/g, '\\$&')}" `
  }

  return `@${normalized} `
}

function normalizeWorkspaceFilePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
}
