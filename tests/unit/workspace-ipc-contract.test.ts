import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, writeFile, truncate, rm } from 'node:fs/promises'
import { MAX_EDITOR_TEXT_BYTES, MAX_HTML_PREVIEW_BYTES } from '../../src/shared/editor'
import {
  FILE_CHANNELS,
  FILE_TREE_CHANNELS,
  WORKSPACE_CHANNELS,
  type FileAPI,
  type FileTreeAPI,
  type WorkspaceAPI,
} from '../../src/shared/ipc/workspace'

const invoke = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()
const handle = vi.fn()
const showItemInFolder = vi.fn()
let exposedApi: {
  workspace: WorkspaceAPI
  fileTree: FileTreeAPI
  file: FileAPI
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
  shell: { showItemInFolder },
}))

beforeAll(async () => {
  await import('../../src/preload/index')
  const { registerWorkspaceHandlers } = await import('../../src/main/ipc/handlers')
  const { registerFileHandlers } = await import('../../src/main/ipc/file-handlers')
  registerWorkspaceHandlers(() => null)
  registerFileHandlers()
})

describe('Workspace/File IPC contract', () => {
  beforeEach(() => {
    invoke.mockReset()
    on.mockReset()
    removeListener.mockReset()
    showItemInFolder.mockReset()
  })

  it('defines unique channels and registers every invoke handler from shared constants', () => {
    const invokeChannels = [
      ...Object.values(WORKSPACE_CHANNELS),
      ...Object.values(FILE_TREE_CHANNELS).filter((channel) => channel !== FILE_TREE_CHANNELS.changed),
      ...Object.values(FILE_CHANNELS),
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
    expect(invoke).toHaveBeenNthCalledWith(1, WORKSPACE_CHANNELS.create, input)
    expect(invoke).toHaveBeenNthCalledWith(2, FILE_TREE_CHANNELS.children, input.path, 'src')
    expect(invoke).toHaveBeenNthCalledWith(3, FILE_TREE_CHANNELS.move, input.path, 'src/demo.ts', 'archive')
    expect(invoke).toHaveBeenNthCalledWith(4, FILE_CHANNELS.save, 'C:\\workspace\\demo\\note.md', 'content')
    await exposedApi.file.save('C:\\workspace\\demo\\note.md', 'draft', 'a'.repeat(64))
    expect(invoke).toHaveBeenNthCalledWith(5, FILE_CHANNELS.save, 'C:\\workspace\\demo\\note.md', 'draft', 'a'.repeat(64))
    await exposedApi.file.reveal('C:\\outside\\中文 空格.md')
    expect(invoke).toHaveBeenNthCalledWith(6, FILE_CHANNELS.reveal, 'C:\\outside\\中文 空格.md')
  })

  it('reveals an existing absolute file, reports missing files and rejects nonlocal paths', async () => {
    const reveal = handle.mock.calls.find(([channel]) => channel === FILE_CHANNELS.reveal)![1]
    const frame = {}, event = { senderFrame: frame, sender: { mainFrame: frame } }
    const folder = await mkdtemp(join(tmpdir(), 'janusx-reveal-'))
    try {
      const file = join(folder, '中文 空格.md')
      await writeFile(file, 'preview')
      await expect(reveal(event, file)).resolves.toEqual({ success: true })
      expect(showItemInFolder).toHaveBeenCalledWith(normalize(file))
      showItemInFolder.mockClear()
      for (const path of [join(folder, 'missing.md'), '../relative.md', 'janusx-workspace://remote/home/a.md', 'https://example.com/a.md', 'bad\0path']) {
        await expect(reveal(event, path)).resolves.toMatchObject({ success: false, error: expect.any(String) })
      }
      await expect(reveal({ ...event, senderFrame: {} }, file)).resolves.toMatchObject({ success: false })
      expect(showItemInFolder).not.toHaveBeenCalled()
      showItemInFolder.mockImplementationOnce(() => { throw new Error('Explorer unavailable') })
      await expect(reveal(event, file)).resolves.toEqual({ success: false, error: 'Explorer unavailable' })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
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

  it('reads complete HTML above 1 MiB and accepts the editor ceiling while rejecting larger files', async () => {
    const read = handle.mock.calls.find(([channel]) => channel === FILE_CHANNELS.read)![1]
    const directory = await mkdtemp(join(tmpdir(), 'janusx-large-editor-'))
    const path = join(directory, 'large.HTML')
    const content = '<!doctype html><title>并行分析</title><!--' + '登录与部署\n'.repeat(100_000) + '--><p>完整结尾</p>'
    expect(Buffer.byteLength(content)).toBeGreaterThan(1024 * 1024)
    try {
      await writeFile(path, content)
      await expect(read({}, path)).resolves.toMatchObject({ content, size: Buffer.byteLength(content) })
      await writeFile(path, Buffer.alloc(MAX_HTML_PREVIEW_BYTES, 65))
      const boundary = await read({}, path)
      expect(boundary.error).toBeUndefined()
      expect(boundary.content.length).toBe(MAX_HTML_PREVIEW_BYTES)
      await truncate(path, MAX_HTML_PREVIEW_BYTES + 1)
      await expect(read({}, path)).resolves.toEqual({ error: `File exceeds ${MAX_HTML_PREVIEW_BYTES} bytes` })
      const textPath = join(directory, 'large.txt')
      await writeFile(textPath, '')
      await truncate(textPath, MAX_EDITOR_TEXT_BYTES + 1)
      await expect(read({}, textPath)).resolves.toEqual({ error: `File exceeds ${MAX_EDITOR_TEXT_BYTES} bytes` })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('does not expose a generic bridge', () => {
    expect(exposedApi).not.toHaveProperty('languageService')
    expect(exposedApi.file).not.toHaveProperty('sourceFiles')
    expect(handle.mock.calls.some(([channel]) => channel.startsWith('language-service:'))).toBe(false)
    expect(exposedApi).not.toHaveProperty('invoke')
    expect(exposedApi).not.toHaveProperty('send')
    expect(exposedApi).not.toHaveProperty('on')
  })
})
