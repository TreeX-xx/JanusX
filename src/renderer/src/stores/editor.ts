import type { EditorDelivery, EditorSession, FileViewState } from '../../../shared/editor'
import { create } from 'zustand'
import { useAuxiliaryPanelsStore } from './auxiliary-panels'
import type { OpenFile, FileViewType } from '@/types'
import type { PluginDraft } from '@janusx/plugin-sdk'
import { getFileViewType, getFileName } from '@/lib/file-utils'

type LoadedFileSnapshot = Pick<
  OpenFile,
  'viewType' | 'content' | 'base64' | 'mimeType' | 'size' | 'mtime'
>

// Evicting a cached disk snapshot never removes an open/dirty tab from openFiles.
// Estimate strings conservatively as UTF-16; this is a payload budget, not heap size.
const MAX_CACHED_BYTES = 16 * 1024 * 1024
const MAX_CACHED_FILE_BYTES = 2 * 1024 * 1024
const MAX_CACHED_FILES = 128
const loadedFileCache = new Map<string, { snapshot: LoadedFileSnapshot; bytes: number }>()
let cachedBytes = 0
const pendingFileLoads = new Map<string, Promise<LoadedFileSnapshot>>()
// Open and reload can overlap for the same tab; only the latest read may apply.
const fileReadRequests = new WeakMap<OpenFile, Promise<LoadedFileSnapshot>>()

function removeCachedFile(id: string): LoadedFileSnapshot | undefined {
  const cached = loadedFileCache.get(id)
  if (!cached) return undefined
  cachedBytes -= cached.bytes
  loadedFileCache.delete(id)
  return cached.snapshot
}

function getCachedFile(id: string): LoadedFileSnapshot | undefined {
  const cached = loadedFileCache.get(id)
  if (!cached) return undefined
  loadedFileCache.delete(id)
  loadedFileCache.set(id, cached)
  return cached.snapshot
}

function cacheFileSnapshot(id: string, snapshot: LoadedFileSnapshot): void {
  removeCachedFile(id)
  const bytes = 2 * (snapshot.content.length + (snapshot.base64?.length ?? 0) + id.length) + 512
  if (bytes > MAX_CACHED_FILE_BYTES) return
  loadedFileCache.set(id, { snapshot, bytes })
  cachedBytes += bytes
  while (cachedBytes > MAX_CACHED_BYTES || loadedFileCache.size > MAX_CACHED_FILES) {
    removeCachedFile(loadedFileCache.keys().next().value!)
  }
}

export function getEditorFileId(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

function isPathInWorkspace(filePath: string, workspacePath: string): boolean {
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase()
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalizedFile === normalizedWorkspace || normalizedFile.startsWith(`${normalizedWorkspace}/`)
}

/** target 与 base 相同,或位于 base 目录之下(分隔符/大小写不敏感) */
function isSameOrUnderPath(target: string, base: string): boolean {
  const t = target.replace(/\\/g, '/').toLowerCase()
  const b = base.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return t === b || t.startsWith(`${b}/`)
}

/** 把 base 之下的绝对路径迁移到 newBase 下,保留后缀原始分隔符 */
function remapAbsolutePath(target: string, base: string, newBase: string): string {
  if (target.length === base.length) return newBase
  return `${newBase}${target.slice(base.length)}`
}

export function invalidateEditorFileCache(workspacePath?: string): void {
  if (!workspacePath) {
    loadedFileCache.clear()
    cachedBytes = 0
    pendingFileLoads.clear()
    return
  }

  for (const filePath of loadedFileCache.keys()) {
    if (isPathInWorkspace(filePath, workspacePath)) {
      removeCachedFile(filePath)
    }
  }
  for (const filePath of pendingFileLoads.keys()) {
    if (isPathInWorkspace(filePath, workspacePath)) pendingFileLoads.delete(filePath)
  }
}

function readResultError(result: unknown): string | null {
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as { error?: unknown }).error
    return typeof error === 'string' ? error : 'Failed to load file'
  }
  return null
}

async function loadFileSnapshot(absolutePath: string, viewType: FileViewType): Promise<LoadedFileSnapshot> {
  const id = getEditorFileId(absolutePath)
  const pending = pendingFileLoads.get(id)
  if (pending) return pending

  const request = (async () => {
    if (viewType === 'image') {
      const result = await window.electron.file.readBinary(absolutePath)
      const error = readResultError(result)
      if (error) throw new Error(error)
      return {
        viewType,
        content: '',
        base64: result.base64 ?? '',
        mimeType: result.mimeType ?? 'application/octet-stream',
        size: result.size,
        mtime: result.mtime,
      }
    }

    if (viewType === 'binary') {
      const result = await window.electron.file.stat(absolutePath)
      const error = readResultError(result)
      if (error) throw new Error(error)
      return {
        viewType,
        content: '',
        size: result.size,
        mtime: result.mtime,
      }
    }

    const result = await window.electron.file.read(absolutePath)
    const error = readResultError(result)
    if (error) throw new Error(error)
    return {
      viewType,
      content: result.content ?? '',
      size: result.size,
      mtime: result.mtime,
    }
  })()

  pendingFileLoads.set(id, request)
  try {
    const snapshot = await request
    if (pendingFileLoads.get(id) === request) cacheFileSnapshot(id, snapshot)
    return snapshot
  } finally {
    if (pendingFileLoads.get(id) === request) pendingFileLoads.delete(id)
  }
}

/** 文件树重命名后同步编辑器:迁移打开的 tab 路径并失效旧缓存 */
export function remapEditorPaths(oldAbsolutePath: string, newAbsolutePath: string, workspacePath: string): void {
  invalidateEditorFileCache(oldAbsolutePath)

  useEditorStore.setState((s) => {
    let changed = false
    const activeFile = s.openFiles.find((file) => file.id === s.activeFileId)
    const openFiles = s.openFiles.map((file) => {
      if (!isSameOrUnderPath(file.absolutePath, oldAbsolutePath)) return file
      changed = true
      const absolutePath = remapAbsolutePath(file.absolutePath, oldAbsolutePath, newAbsolutePath)
      return {
        ...file,
        id: getEditorFileId(absolutePath),
        absolutePath,
        name: getFileName(absolutePath),
        path: absolutePath.replace(workspacePath, '').replace(/^[\\/]/, ''),
      }
    })
    if (!changed) return {}
    const activeFileId =
      activeFile && isSameOrUnderPath(activeFile.absolutePath, oldAbsolutePath)
        ? getEditorFileId(remapAbsolutePath(activeFile.absolutePath, oldAbsolutePath, newAbsolutePath))
        : s.activeFileId
    return { openFiles, activeFileId }
  })
}

/** 文件树删除后同步编辑器:关闭指向已删除路径的 tab、清理缓存 */
export function closeEditorFilesUnderPath(absolutePath: string): void {
  const store = useEditorStore.getState()
  for (const file of store.openFiles) {
    if (isSameOrUnderPath(file.absolutePath, absolutePath)) store.closeFile(file.id)
  }
  invalidateEditorFileCache(absolutePath)
}

interface EditorStore {
  workspacePath: string | null
  sessions: Record<string, EditorSession & { visible: boolean }>
  switchScope: (workspacePath: string | null) => void
  acceptDelivery: (payload: EditorDelivery) => Promise<void>
  releaseScope: (workspacePath: string) => void
  exportSession: () => EditorSession
  updateViewState: (id: string, state: Partial<FileViewState>) => void

  openFiles: OpenFile[]
  activeFileId: string | null
  isVisible: boolean
  isEmbedded: boolean
  embeddedWidth: number
  navigationTarget: EditorNavigationTarget | null

  openFile: (absolutePath: string, workspacePath: string) => Promise<void>
  openFileAt: (absolutePath: string, workspacePath: string, selection: EditorSelection) => Promise<void>
  consumeNavigationTarget: (requestId: number) => void
  closeFile: (id: string) => void
  setActiveFile: (id: string) => void
  markDirty: (id: string) => void
  updateContent: (id: string, content: string) => void
  applyPluginDraft: (id: string, baseText: string, text: string, version: string, viewer: string) => boolean
  accessPluginDraft: (id: string, viewer: string, baseText: string, version: string, update?: { text: string; expectedRevision: number }) => PluginDraft | null
  saveFile: (id: string) => Promise<boolean>
  saveReviewedConflict: (id: string, version: string) => Promise<boolean>
  reloadOpenFile: (absolutePath: string) => Promise<void>
  reloadOpenFiles: (workspacePath: string, changedFilePath?: string | null) => Promise<void>
  hasDirtyFiles: () => boolean
  closePanel: () => void
  hidePanel: () => void
  showPanel: () => void
  togglePanel: () => void
  setEmbedded: (embedded: boolean) => void
  setEmbeddedWidth: (width: number) => void
}

export interface EditorSelection {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface EditorNavigationTarget {
  requestId: number
  fileId: string
  selection: EditorSelection
}

function replaceLoadedFile(state: EditorStore, target: OpenFile, patch: Partial<OpenFile>) {
  const replace = (files: OpenFile[]) => files.map(file => file === target ? { ...file, ...patch } : file)
  return { openFiles: replace(state.openFiles), sessions: Object.fromEntries(Object.entries(state.sessions).map(([key, session]) => [key, { ...session, files: replace(session.files) }])) }
}

let navigationRequestId = 0

export const useEditorStore = create<EditorStore>((set, get) => ({
  workspacePath: null,
  sessions: {},
  switchScope: (workspacePath) => {
    const current = get()
    if (getEditorFileId(current.workspacePath ?? '') === getEditorFileId(workspacePath ?? '')) return
    const sessions = { ...current.sessions }
    if (current.workspacePath) sessions[getEditorFileId(current.workspacePath)] = {
      files: current.openFiles, activeFileId: current.activeFileId, visible: current.isVisible,
    }
    const session = workspacePath ? sessions[getEditorFileId(workspacePath)] : undefined
    set({ workspacePath, sessions, openFiles: session?.files ?? [], activeFileId: session?.activeFileId ?? null,
      isVisible: session?.visible ?? false, isEmbedded: true, navigationTarget: null })
  },
  releaseScope: (workspacePath) => {
    const key = getEditorFileId(workspacePath)
    set(s => {
      const { [key]: released, ...sessions } = s.sessions
      void released
      return getEditorFileId(s.workspacePath ?? '') === key
        ? { sessions, openFiles: [], activeFileId: null, isVisible: false, navigationTarget: null }
        : { sessions }
    })
  },
  exportSession: () => ({ files: get().openFiles, activeFileId: get().activeFileId }),
  acceptDelivery: async (payload) => {
    if (!payload.filePath || !payload.workspacePath) throw new Error('Missing editor scope')
    if (payload.session && (!payload.session.files.length || payload.session.files.some(file => file.isLoading))) throw new Error('Editor session is still loading')
    useAuxiliaryPanelsStore.getState().activate('editor')
    get().switchScope(payload.workspacePath)
    if (payload.session) {
      const files = payload.session.files
      set({ openFiles: files, activeFileId: payload.session.activeFileId ?? files[0].id, isVisible: true, isEmbedded: true })
    } else {
      await get().openFile(payload.filePath, payload.workspacePath)
      if (payload.isDirty && payload.content !== undefined) get().updateContent(getEditorFileId(payload.filePath), payload.content)
      set({ isEmbedded: true })
    }
  },
  updateViewState: (id, state) => set(s => ({ openFiles: s.openFiles.map(file => file.id === id ? { ...file, viewState: { ...file.viewState, ...state } } : file) })),
  openFiles: [],
  activeFileId: null,
  isVisible: false,
  isEmbedded: true,
  embeddedWidth: 560,
  navigationTarget: null,

  openFile: async (absolutePath, workspacePath) => {
    useAuxiliaryPanelsStore.getState().activate('editor')
    get().switchScope(workspacePath)
    const id = getEditorFileId(absolutePath)
    const existing = get().openFiles.find(f => f.id === id)
    if (existing) {
      set({ activeFileId: id, isVisible: true })
      return
    }

    const viewType = getFileViewType(absolutePath)
    const name = getFileName(absolutePath)
    const relativePath = absolutePath.replace(workspacePath, '').replace(/^[\\/]/, '')
    const cached = getCachedFile(id)

    const newFile: OpenFile = {
      id, name, path: relativePath, absolutePath, viewType,
      content: cached?.content ?? '', isDirty: false, isLoading: !cached,
      base64: cached?.base64, mimeType: cached?.mimeType,
      size: cached?.size, mtime: cached?.mtime,
    }

    set(s => ({
      openFiles: [...s.openFiles, newFile],
      activeFileId: id,
      isVisible: true,
    }))

    if (cached) return

    const request = loadFileSnapshot(absolutePath, viewType)
    fileReadRequests.set(newFile, request)
    try {
      const snapshot = await request
      if (fileReadRequests.get(newFile) !== request) return
      set(s => replaceLoadedFile(s, newFile, { ...snapshot, isLoading: false }))
    } catch (err: any) {
      if (fileReadRequests.get(newFile) !== request) return
      set(s => replaceLoadedFile(s, newFile, { error: err.message || 'Failed to load file', isLoading: false }))
    }
  },

  openFileAt: async (absolutePath, workspacePath, selection) => {
    await get().openFile(absolutePath, workspacePath)
    const fileId = getEditorFileId(absolutePath)
    if (!get().openFiles.some((file) => file.id === fileId)) return
    set({
      activeFileId: fileId,
      isVisible: true,
      navigationTarget: { requestId: ++navigationRequestId, fileId, selection },
    })
  },

  consumeNavigationTarget: (requestId) => {
    set((state) => state.navigationTarget?.requestId === requestId ? { navigationTarget: null } : {})
  },

  closeFile: (id) => {
    pendingFileLoads.delete(id)
    set(s => {
      const filtered = s.openFiles.filter(f => f.id !== id)
      let newActive = s.activeFileId
      if (s.activeFileId === id) {
        const idx = s.openFiles.findIndex(f => f.id === id)
        newActive = filtered[Math.min(idx, filtered.length - 1)]?.id ?? null
      }
      return {
        openFiles: filtered,
        activeFileId: newActive,
        isVisible: filtered.length > 0 ? s.isVisible : false,
        isEmbedded: true,
        navigationTarget: s.navigationTarget?.fileId === id ? null : s.navigationTarget,
      }
    })
  },

  setActiveFile: (id) => set({ activeFileId: id, navigationTarget: null }),

  markDirty: (id) => {
    set(s => ({
      openFiles: s.openFiles.map(f => f.id === id ? { ...f, isDirty: true } : f),
    }))
  },

  updateContent: (id, content) => {
    set(s => ({
      openFiles: s.openFiles.map(f =>
        f.id === id && f.content !== content ? { ...f, content, isDirty: true, draftRevision: (f.draftRevision ?? 0) + 1 } : f
      ),
    }))
  },

  accessPluginDraft: (id, viewer, baseText, version, update) => {
    const file = get().openFiles.find(f => f.id === id)
    if (!file || file.isLoading || file.error || file.saveConflict) return null
    const owns = file.pluginDraftViewer === viewer && file.pluginDraftSession
    if (!owns && (file.isDirty || file.content !== baseText)) return null
    const revision = file.draftRevision ?? 0
    if (update && update.expectedRevision !== revision) return null
    const changed = update !== undefined && update.text !== file.content
    const next = { ...file, pluginDraftViewer: viewer, pluginDraftSession: true,
      saveVersion: owns ? file.saveVersion! : version, draftRevision: revision + (changed ? 1 : 0),
      content: update?.text ?? file.content, isDirty: file.isDirty || changed,
      externalChanged: owns ? file.saveVersion !== version : false }
    if (next.content.length > 1024 * 1024 || new TextEncoder().encode(next.content).byteLength > 1024 * 1024 || next.content.includes('\0')) return null
    set(s => ({ openFiles: s.openFiles.map(f => f === file ? next : f) }))
    return { text: next.content, revision: next.draftRevision, version: next.saveVersion, dirty: next.isDirty, externalChanged: next.externalChanged }
  },

  applyPluginDraft: (id, baseText, text, version, viewer) => {
    const file = get().openFiles.find(f => f.id === id)
    if (!file || file.isDirty || file.isLoading || file.error || file.content !== baseText) return false
    set(s => ({ openFiles: s.openFiles.map(f => f === file ? { ...f, content: text, isDirty: true,
      saveVersion: version, pluginDraftViewer: viewer } : f) }))
    return true
  },

  saveFile: async (id) => {
    const file = get().openFiles.find(f => f.id === id)
    if (!file) return false
    try {
      const result = file.saveVersion
        ? await window.electron.file.save(file.absolutePath, file.content, file.saveVersion)
        : await window.electron.file.save(file.absolutePath, file.content)
      if (result.conflict) {
        set(s => {
          const patch = (f: OpenFile) => f.id === id && f.saveVersion === file.saveVersion
            ? { ...f, externalChanged: true, saveConflict: true, conflictDisk: result.current } : f
          return { openFiles: s.openFiles.map(patch), sessions: Object.fromEntries(Object.entries(s.sessions)
            .map(([key, session]) => [key, { ...session, files: session.files.map(patch) }])) }
        })
        return false
      }
      if (!result.success) throw new Error(result.error || 'Failed to save file')
      cacheFileSnapshot(file.id, {
        viewType: file.viewType,
        content: file.content,
        base64: file.base64,
        mimeType: file.mimeType,
        size: file.size,
        mtime: Date.now(),
      })
      set(s => {
        const patch = (f: OpenFile) => f.id === id && f.saveVersion === file.saveVersion ? { ...f,
          isDirty: f.content !== file.content, mtime: Date.now(), saveVersion: result.version ?? f.saveVersion,
          pluginDraftViewer: f.pluginDraftSession ? f.pluginDraftViewer : undefined, draftRevision: (f.draftRevision ?? 0) + 1,
          externalChanged: false, saveConflict: false, conflictDisk: undefined } : f
        return { openFiles: s.openFiles.map(patch), sessions: Object.fromEntries(Object.entries(s.sessions)
          .map(([key, session]) => [key, { ...session, files: session.files.map(patch) }])) }
      })
      return true
    } catch (err: any) {
      console.error('Save failed:', err)
      return false
    }
  },


  saveReviewedConflict: async (id, version) => {
    const file = get().openFiles.find(f => f.id === id)
    if (!file?.saveConflict || file.conflictDisk?.version !== version) return false
    // The user reviewed this exact disk snapshot. A subsequent save rechecks it.
    set(s => ({ openFiles: s.openFiles.map(f => f === file ? { ...f, saveVersion: version } : f) }))
    return get().saveFile(id)
  },

  reloadOpenFile: async (absolutePath) => {
    const id = getEditorFileId(absolutePath)
    const file = get().openFiles.find(f => f.id === id) ?? Object.values(get().sessions).flatMap(session => session.files).find(f => f.id === id)
    if (!file) return

    if (file.isDirty) {
      set(s => replaceLoadedFile(s, file, { externalChanged: true }))
      return
    }

    removeCachedFile(id)
    const request = loadFileSnapshot(absolutePath, file.viewType)
    fileReadRequests.set(file, request)
    try {
      const snapshot = await request
      if (fileReadRequests.get(file) !== request) return
      set(s => replaceLoadedFile(s, file, { ...snapshot, error: undefined, externalChanged: false, isLoading: false,
        saveVersion: undefined, pluginDraftViewer: undefined, saveConflict: false, conflictDisk: undefined }))
    } catch (err) {
      if (fileReadRequests.get(file) !== request) return
      const msg = err instanceof Error ? err.message : String(err)
      set(s => replaceLoadedFile(s, file, { error: msg }))
    }
  },

  reloadOpenFiles: async (workspacePath, changedFilePath) => {
    if (changedFilePath) {
      await get().reloadOpenFile(changedFilePath)
      return
    }
    const files = [...get().openFiles, ...Object.values(get().sessions).flatMap(session => session.files)].filter(f =>
      isPathInWorkspace(f.absolutePath, workspacePath)
    )
    for (const file of files) {
      await get().reloadOpenFile(file.absolutePath)
    }
  },

  hasDirtyFiles: () => get().openFiles.some(f => f.isDirty),

  closePanel: () => {
    pendingFileLoads.clear()
    if (get().workspacePath) get().releaseScope(get().workspacePath!)
    else set({ openFiles: [], activeFileId: null, isVisible: false, isEmbedded: true, navigationTarget: null })
  },
  hidePanel: () => set({ isVisible: false }),
  showPanel: () => {
    useAuxiliaryPanelsStore.getState().activate('editor')
    set(s => ({ isVisible: s.openFiles.length > 0 }))
  },
  togglePanel: () => get().isVisible ? get().hidePanel() : get().showPanel(),
  setEmbedded: (isEmbedded) => set({ isEmbedded }),
  setEmbeddedWidth: (embeddedWidth) => set({ embeddedWidth }),
}))
