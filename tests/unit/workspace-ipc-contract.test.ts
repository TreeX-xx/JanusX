import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILE_CHANNELS,
  FILE_TREE_CHANNELS,
  WORKSPACE_CHANNELS,
  type FileAPI,
  type FileTreeAPI,
  type WorkspaceAPI,
} from '../../src/shared/ipc/workspace'
import {
  LANGUAGE_SERVICE_CHANNELS,
  type LanguageServiceAPI,
} from '../../src/shared/ipc/language-service'

const invoke = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()
const handle = vi.fn()
let exposedApi: {
  workspace: WorkspaceAPI
  fileTree: FileTreeAPI
  file: FileAPI
  languageService: LanguageServiceAPI
}

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\tmp' },
  BrowserWindow: class {},
  contextBridge: {
    exposeInMainWorld: (_name: string, api: typeof exposedApi) => {
      exposedApi = api
    },
  },
  dialog: {},
  ipcMain: { handle },
  ipcRenderer: { invoke, send: vi.fn(), on, removeListener },
  shell: {},
}))

beforeAll(async () => {
  await import('../../src/preload/index')
  const { registerWorkspaceHandlers } = await import('../../src/main/ipc/handlers')
  const { registerFileHandlers } = await import('../../src/main/ipc/file-handlers')
  const { registerLanguageServiceHandlers } = await import('../../src/main/ipc/language-service-handlers')
  const { registerLanguageServiceInstallerHandlers } = await import('../../src/main/ipc/language-service-installer-handlers')
  registerWorkspaceHandlers(() => null)
  registerFileHandlers()
  registerLanguageServiceHandlers()
  registerLanguageServiceInstallerHandlers({ getAllowedWindows: () => [], installers: new Map() })
})

describe('Workspace/File IPC contract', () => {
  beforeEach(() => {
    invoke.mockReset()
    on.mockReset()
    removeListener.mockReset()
  })

  it('defines unique channels and registers every invoke handler from shared constants', () => {
    const invokeChannels = [
      ...Object.values(WORKSPACE_CHANNELS),
      ...Object.values(FILE_TREE_CHANNELS).filter((channel) => channel !== FILE_TREE_CHANNELS.changed),
      ...Object.values(FILE_CHANNELS),
      ...Object.values(LANGUAGE_SERVICE_CHANNELS),
    ]
    const registered = handle.mock.calls.map(([channel]) => channel)

    expect(new Set(invokeChannels).size).toBe(invokeChannels.length)
    expect(registered).toEqual(expect.arrayContaining(invokeChannels))
  })

  it('routes typed domain methods with the shared channel and argument order', async () => {
    const input = { name: 'demo', path: 'C:\\workspace\\demo' }
    invoke.mockResolvedValue({ id: 'workspace-1', ...input })

    await exposedApi.workspace.create(input)
    await exposedApi.fileTree.children(input.path, 'src')
    await exposedApi.fileTree.move(input.path, 'src/demo.ts', 'archive')
    await exposedApi.file.save('C:\\workspace\\demo\\note.md', 'content')
    const definitionRequest = {
      workspacePath: input.path,
      filePath: 'C:\\workspace\\demo\\main.cpp',
      language: 'cpp' as const,
      content: 'int main() {}',
      position: { line: 0, character: 4 },
    }
    await exposedApi.languageService.definition(definitionRequest)

    expect(invoke).toHaveBeenNthCalledWith(1, WORKSPACE_CHANNELS.create, input)
    expect(invoke).toHaveBeenNthCalledWith(2, FILE_TREE_CHANNELS.children, input.path, 'src')
    expect(invoke).toHaveBeenNthCalledWith(3, FILE_TREE_CHANNELS.move, input.path, 'src/demo.ts', 'archive')
    expect(invoke).toHaveBeenNthCalledWith(4, FILE_CHANNELS.save, 'C:\\workspace\\demo\\note.md', 'content')
    expect(invoke).toHaveBeenNthCalledWith(5, LANGUAGE_SERVICE_CHANNELS.definition, definitionRequest)
    await exposedApi.file.save('C:\\workspace\\demo\\note.md', 'draft', 'a'.repeat(64))
    expect(invoke).toHaveBeenNthCalledWith(6, FILE_CHANNELS.save, 'C:\\workspace\\demo\\note.md', 'draft', 'a'.repeat(64))
  })

  it('preserves file-tree event payload and unsubscribe semantics', () => {
    const callback = vi.fn()
    const unsubscribe = exposedApi.fileTree.onChanged(callback)
    const handler = on.mock.calls.at(-1)?.[1]

    handler({}, 'C:\\workspace\\demo')
    expect(callback).toHaveBeenCalledWith('C:\\workspace\\demo')

    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(FILE_TREE_CHANNELS.changed, handler)
  })

  it('does not expose a generic bridge', () => {
    expect(exposedApi).not.toHaveProperty('invoke')
    expect(exposedApi).not.toHaveProperty('send')
    expect(exposedApi).not.toHaveProperty('on')
  })
})
